const http = require('http');
const fs = require('fs');
const path = require('path');

const opcodes = {
    NOP: 0, BREAK: 1, LOADNIL: 2, LOADB: 3, LOADN: 4, LOADK: 5, MOVE: 6,
    GETGLOBAL: 7, SETGLOBAL: 8, GETUPVAL: 9, SETUPVAL: 10, CLOSEUPVALS: 11,
    GETIMPORT: 12, GETTABLE: 13, SETTABLE: 14, GETTABLEKS: 15, SETTABLEKS: 16,
    NAMECALL: 19, CALL: 20, RETURN: 21, JUMP: 22, JUMPIF: 24, JUMPIFNOT: 25,
    NEWCLOSURE: 28, DUPCLOSURE: 29, CAPTURE: 30, ADD: 31, SUB: 32, MUL: 33, 
    DIV: 34, ADDK: 37, SUBK: 38, MULK: 39, DIVK: 40, CONCAT: 45
};

const opcodeVectors = {
    3: { 
        [0xA4]: opcodes.GETGLOBAL, [0x9F]: opcodes.LOADK, [0x52]: opcodes.NAMECALL, 
        [0x51]: opcodes.CALL, [0x05]: opcodes.RETURN, [0x4D]: opcodes.JUMP, 
        [0x4E]: opcodes.JUMPIF, [0x4F]: opcodes.JUMPIFNOT, [0x12]: opcodes.GETUPVAL, 
        [0x13]: opcodes.SETUPVAL, [0x4A]: opcodes.GETTABLEKS, [0x4B]: opcodes.SETTABLEKS, 
        [0x17]: opcodes.ADD, [0x18]: opcodes.SUB, [0x19]: opcodes.MUL, [0x1A]: opcodes.DIV,
        [0x82]: opcodes.MOVE, [0x30]: opcodes.DUPCLOSURE, [0x1F]: opcodes.CAPTURE,
        [0xBC]: opcodes.CONCAT, [0x04]: opcodes.LOADN, [0x9F]: opcodes.LOADK
    }
};

function readVarint(buffer, state) {
    let result = 0;
    let shift = 0;
    while (state.ptr < buffer.length) {
        let byte = buffer[state.ptr++];
        result |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) break;
        shift += 7;
    }
    return result;
}

function processFunctionPrototype(buffer, state, stringTable, vectors, protoId, sharedKnowledgeBase) {
    return new Promise((resolve) => {
        let localRegisters = {};
        let linesOfCode = [];
        let definedLocals = new Set();
        let upvalues = [];
        
        const sizeCode = readVarint(buffer, state);
        const codeStart = state.ptr;
        state.ptr += sizeCode * 4; 

        for (let i = 0; i < sizeCode; i++) {
            let instPtr = codeStart + (i * 4);
            if (instPtr + 4 > buffer.length) break;

            const rawOp = buffer[instPtr];
            const op = vectors[rawOp] !== undefined ? vectors[rawOp] : opcodes.NOP;
            
            const rA = buffer[instPtr + 1];
            const rB = buffer[instPtr + 2];
            const rC = buffer[instPtr + 3];
            
            const rBx = (rB << 8) | rC;
            const sBx = rBx >= 0x8000 ? rBx - 0x10000 : rBx;

            if (op === opcodes.GETGLOBAL) {
                const kStr = stringTable[rBx] || stringTable[rB];
                if (kStr) localRegisters[rA] = kStr;
            } 
            else if (op === opcodes.LOADK) {
                const kStr = stringTable[rBx] || stringTable[rB];
                if (kStr) localRegisters[rA] = isNaN(kStr) ? `"${kStr}"` : kStr;
            }
            else if (op === opcodes.LOADN) {
                localRegisters[rA] = sBx;
            }
            else if (op === opcodes.MOVE) {
                localRegisters[rA] = localRegisters[rB] || `var_${rB}`;
            }
            else if (op === opcodes.GETTABLEKS) {
                const indexStr = stringTable[rC];
                const baseVar = localRegisters[rB] || `var_${rB}`;
                if (indexStr) localRegisters[rA] = `${baseVar}.${indexStr}`;
            }
            else if (op === opcodes.SETTABLEKS) {
                const indexStr = stringTable[rC];
                const baseVar = localRegisters[rA] || `var_${rA}`;
                const valueVar = localRegisters[rB] || `var_${rB}`;
                if (indexStr) linesOfCode.push(`    ${baseVar}.${indexStr} = ${valueVar}`);
            }
            else if (op === opcodes.SETGLOBAL) {
                const kStr = stringTable[rBx] || stringTable[rB];
                const valueVar = localRegisters[rA] || `var_${rA}`;
                linesOfCode.push(`    ${kStr} = ${valueVar}`);
            }
            else if (op === opcodes.NAMECALL) {
                const methodStr = stringTable[rC];
                const targetVar = localRegisters[rB] || `var_${rB}`;
                if (methodStr) {
                    localRegisters[rA + 1] = targetVar; 
                    localRegisters[rA] = `${targetVar}:${methodStr}`;
                }
            }
            else if (op === opcodes.CALL) {
                const funcVar = localRegisters[rA] || `var_${rA}`;
                let args = [];
                for (let argReg = rA + 1; argReg < rA + rB; argReg++) {
                    args.push(localRegisters[argReg] || `var_${argReg}`);
                }
                
                if (funcVar.includes(":GetService") && args.length > 0) {
                    const cleanService = args[0].replace(/"/g, '');
                    const serviceVar = cleanService.charAt(0).toLowerCase() + cleanService.slice(1);
                    linesOfCode.push(`    local ${serviceVar} = game:GetService(${args[0]})`);
                    localRegisters[rA] = serviceVar;
                    definedLocals.add(rA);
                } else {
                    const callStr = `${funcVar}(${args.join(", ")})`;
                    if (rC === 0) {
                        linesOfCode.push(`    ${callStr}`);
                    } else {
                        if (!definedLocals.has(rA)) {
                            linesOfCode.push(`    local var_${rA} = ${callStr}`);
                            definedLocals.add(rA);
                        } else {
                            linesOfCode.push(`    var_${rA} = ${callStr}`);
                        }
                        localRegisters[rA] = `var_${rA}`;
                    }
                }
            }
            else if (op === opcodes.GETUPVAL) {
                localRegisters[rA] = sharedKnowledgeBase.upvalueMap[rB] || `upvalue_${rB}`;
            }
            else if (op === opcodes.SETUPVAL) {
                const valueVar = localRegisters[rA] || `var_${rA}`;
                const upName = sharedKnowledgeBase.upvalueMap[rB] || `upvalue_${rB}`;
                linesOfCode.push(`    ${upName} = ${valueVar}`);
            }
            else if (op === opcodes.DUPCLOSURE || op === opcodes.NEWCLOSURE) {
                const targetProto = rBx;
                localRegisters[rA] = `closure_prototype_${targetProto}`;
            }
            else if (op === opcodes.CAPTURE) {
                upvalues.push({ type: rA, source: rB });
            }
            else if (op === opcodes.CONCAT) {
                let parts = [];
                for (let r = rB; r <= rC; r++) {
                    parts.push(localRegisters[r] || `var_${r}`);
                }
                localRegisters[rA] = parts.join(" .. ");
                if (!definedLocals.has(rA)) {
                    linesOfCode.push(`    local var_${rA} = ${localRegisters[rA]}`);
                    definedLocals.add(rA);
                } else {
                    linesOfCode.push(`    var_${rA} = ${localRegisters[rA]}`);
                }
            }
            else if (op === opcodes.ADD || op === opcodes.sub || op === opcodes.mul || op === opcodes.div) {
                const term1 = localRegisters[rB] || `var_${rB}`;
                const term2 = localRegisters[rC] || `var_${rC}`;
                let sym = "+";
                if (op === opcodes.SUB) sym = "-";
                else if (op === opcodes.MUL) sym = "*";
                else if (op === opcodes.DIV) sym = "/";
                const expr = `(${term1} ${sym} ${term2})`;
                localRegisters[rA] = expr;
                if (!definedLocals.has(rA)) {
                    linesOfCode.push(`    local var_${rA} = ${expr}`);
                    definedLocals.add(rA);
                } else {
                    linesOfCode.push(`    var_${rA} = ${expr}`);
                }
            }
        }

        if (state.ptr < buffer.length) readVarint(buffer, state); 
        if (state.ptr < buffer.length) readVarint(buffer, state); 
        if (state.ptr < buffer.length) readVarint(buffer, state); 

        resolve({ protoId, code: linesOfCode, registers: localRegisters });
    });
}

function decompileLuau(hexString, callback) {
    try {
        const cleanHex = hexString.replace(/\s+/g, '');
        if (!cleanHex || cleanHex.length % 2 !== 0) return callback("-- Error: Malformed hex");
        
        const buffer = Buffer.from(cleanHex, 'hex');
        if (buffer.length < 4) return callback("-- Error: Input too small");

        let state = { ptr: 0 };
        const luauVersion = buffer[state.ptr++];
        const bytecodeVersion = luauVersion >= 4 ? buffer[state.ptr++] : luauVersion;

        const vectors = opcodeVectors[bytecodeVersion] || opcodeVectors[3];

        const stringCount = readVarint(buffer, state);
        let stringTable = [];
        let currentStr = "";
        
        for (let i = state.ptr; i < buffer.length; i++) {
            const byte = buffer[i];
            if (byte >= 32 && byte <= 126) {
                currentStr += String.fromCharCode(byte);
            } else {
                if (currentStr.length >= 1 && !/^[ @PMp\t]+$/.test(currentStr)) {
                    stringTable.push(currentStr);
                }
                currentStr = "";
            }
        }

        const uniqueStrings = [...new Set(stringTable)];
        
        for (let s = 0; s < stringCount; s++) {
            if (state.ptr >= buffer.length) break;
            readVarint(buffer, state);
        }

        const protoCount = readVarint(buffer, state);
        let sharedKnowledgeBase = { globals: new Set(), hints: [], upvalueMap: {} };
        let crawlerPromises = [];

        uniqueStrings.forEach((str, idx) => {
            if (str.length >= 1 && !str.endsWith("Service")) {
                sharedKnowledgeBase.upvalueMap[idx] = `tracked_${str.toLowerCase()}`;
            }
        });

        // Map implicit upvalue indexing maps
        sharedKnowledgeBase.upvalueMap[0] = "times";

        for (let p = 0; p < protoCount; p++) {
            if (state.ptr >= buffer.length) break;
            crawlerPromises.push(processFunctionPrototype(buffer, state, uniqueStrings, vectors, p, sharedKnowledgeBase));
        }

        Promise.all(crawlerPromises).then((results) => {
            let output = `-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n\n`;

            results.forEach(res => {
                if (res.code.length > 0) {
                    if (res.protoId === results.length - 1) {
                        output += `-- Master Entry Script Thread\n`;
                        output += res.code.join("\n") + "\n";
                    } else {
                        output += `function closure_prototype_${res.protoId}(...)\n`;
                        output += res.code.join("\n") + "\n";
                        output += `end\n\n`;
                    }
                }
            });

            callback(output);
        });

    } catch (err) {
        callback(`-- Error: Reconstruction failure`);
    }
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.includes('/api/decompile')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                decompileLuau(data.bytecodeHex || '', (resultSource) => {
                    res.writeHead(200, { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*' 
                    });
                    res.end(JSON.stringify({ success: true, code: resultSource }));
                });
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Error' }));
            }
        });
    } else if (req.method === 'GET') {
        const uiPath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(uiPath, (err, htmlData) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(htmlData);
            }
        });
    } else {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('405');
    }
});

const port = process.env.PORT || 3000;
server.listen(port);
