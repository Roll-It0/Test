const http = require('http');
const fs = require('fs');
const path = require('path');

const opcodeVectors = {
    3: { getGlobal: 0xA4, loadK: 0x9F, nameCall: 0x52, close: 0x1E, jump: 0x4D, getUpvalue: 0x12, setUpvalue: 0x13, jmpIf: 0x4E, jmpIfNot: 0x4F, getTableKs: 0x4A, setTableKs: 0x4B, call: 0x51, add: 0x17, sub: 0x18, mul: 0x19, div: 0x1A },
    4: { getGlobal: 0xB2, loadK: 0xA1, nameCall: 0x58, close: 0x22, jump: 0x51, getUpvalue: 0x15, setUpvalue: 0x16, jmpIf: 0x52, jmpIfNot: 0x53, getTableKs: 0x4E, setTableKs: 0x4F, call: 0x57, add: 0x1B, sub: 0x1C, mul: 0x1D, div: 0x1E },
    5: { getGlobal: 0xC1, loadK: 0xB5, nameCall: 0x61, close: 0x2A, jump: 0x5D, getUpvalue: 0x19, setUpvalue: 0x1A, jmpIf: 0x5E, jmpIfNot: 0x5F, getTableKs: 0x57, setTableKs: 0x58, call: 0x60, add: 0x21, sub: 0x22, mul: 0x23, div: 0x24 },
    6: { getGlobal: 0xD4, loadK: 0xC2, nameCall: 0x6E, close: 0x31, jump: 0x65, getUpvalue: 0x20, setUpvalue: 0x21, jmpIf: 0x66, jmpIfNot: 0x67, getTableKs: 0x63, setTableKs: 0x64, call: 0x6D, add: 0x28, sub: 0x29, mul: 0x2A, div: 0x2B }
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
        
        const sizeCode = readVarint(buffer, state);
        const codeStart = state.ptr;
        state.ptr += sizeCode * 4; 

        for (let i = 0; i < sizeCode; i++) {
            let instPtr = codeStart + (i * 4);
            if (instPtr + 4 > buffer.length) break;

            const op = buffer[instPtr];
            const rA = buffer[instPtr + 1];
            const rB = buffer[instPtr + 2];
            const rC = buffer[instPtr + 3];

            if (op === vectors.getGlobal) {
                const kStr = stringTable[rB];
                if (kStr) {
                    localRegisters[rA] = kStr;
                }
            } 
            else if (op === vectors.loadK) {
                const kStr = stringTable[rB];
                if (kStr) {
                    localRegisters[rA] = isNaN(kStr) ? `"${kStr}"` : kStr;
                }
            } 
            else if (op === vectors.getTableKs) {
                const indexStr = stringTable[rC];
                const baseVar = localRegisters[rB] || `var_${rB}`;
                if (indexStr) {
                    localRegisters[rA] = `${baseVar}.${indexStr}`;
                }
            }
            else if (op === vectors.setTableKs) {
                const indexStr = stringTable[rC];
                const baseVar = localRegisters[rA] || `var_${rA}`;
                const valueVar = localRegisters[rB] || `var_${rB}`;
                if (indexStr) linesOfCode.push(`    ${baseVar}.${indexStr} = ${valueVar}`);
            }
            else if (op === vectors.nameCall) {
                const methodStr = stringTable[rC];
                const targetVar = localRegisters[rB] || `var_${rB}`;
                if (methodStr) {
                    localRegisters[rA + 1] = targetVar; 
                    localRegisters[rA] = `${targetVar}:${methodStr}`;
                }
            }
            else if (op === vectors.call) {
                const funcVar = localRegisters[rA] || `var_${rA}`;
                let args = [];
                for (let argReg = rA + 1; argReg < rA + rB; argReg++) {
                    args.push(localRegisters[argReg] || `var_${argReg}`);
                }
                
                if (funcVar.includes(":GetService") && args[0]) {
                    const cleanService = args[0].replace(/"/g, '');
                    const serviceVar = cleanService.charAt(0).toLowerCase() + cleanService.slice(1);
                    linesOfCode.push(`    local ${serviceVar} = game:GetService(${args[0]})`);
                    localRegisters[rA] = serviceVar;
                    definedLocals.add(rA);
                } else {
                    if (rC === 0) {
                        linesOfCode.push(`    ${funcVar}(${args.join(", ")})`);
                    } else {
                        const callStr = `${funcVar}(${args.join(", ")})`;
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
            else if (op === vectors.jmpIf || op === vectors.jmpIfNot) {
                const condVar = localRegisters[rA] || "condition";
                linesOfCode.push(`    if ${op === vectors.jmpIf ? "" : "not "}${condVar} then`);
                linesOfCode.push(`    end`);
            }
            else if (op === vectors.getUpvalue) {
                localRegisters[rA] = sharedKnowledgeBase.upvalueMap[rB] || `upvalue_${rB}`;
            }
            else if (op === vectors.setUpvalue) {
                const valueVar = localRegisters[rA] || `var_${rA}`;
                const upName = sharedKnowledgeBase.upvalueMap[rB] || `upvalue_${rB}`;
                linesOfCode.push(`    ${upName} = ${valueVar}`);
            }
            else if (op === vectors.add || op === vectors.sub || op === vectors.mul || op === vectors.div) {
                const term1 = localRegisters[rB] || `var_${rB}`;
                const term2 = localRegisters[rC] || `var_${rC}`;
                let sym = "+";
                if (op === vectors.sub) sym = "-";
                else if (op === vectors.mul) sym = "*";
                else if (op === vectors.div) sym = "/";
                
                const expression = `(${term1} ${sym} ${term2})`;
                localRegisters[rA] = expression;
                
                if (!definedLocals.has(rA)) {
                    linesOfCode.push(`    local var_${rA} = ${expression}`);
                    definedLocals.add(rA);
                } else {
                    linesOfCode.push(`    var_${rA} = ${expression}`);
                }
            }
        }

        // Fast forward through prototype structural metadata layers safely
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

        const vectors = opcodeVectors[bytecodeVersion] || opcodeVectors;

        const stringCount = readVarint(buffer, state);
        let stringTable = [];
        let currentStr = "";
        
        for (let i = state.ptr; i < buffer.length; i++) {
            const byte = buffer[i];
            if (byte >= 32 && byte <= 126) {
                currentStr += String.fromCharCode(byte);
            } else {
                if (currentStr.length >= 2 && !/^[ @PMp\t]+$/.test(currentStr)) {
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

        // Build upvalue mapping based on extracted script parameters
        uniqueStrings.forEach((str, idx) => {
            if (str.length > 2 && !str.endsWith("Service")) {
                sharedKnowledgeBase.upvalueMap[idx] = `tracked_${str.toLowerCase()}`;
            }
        });

        for (let p = 0; p < protoCount; p++) {
            if (state.ptr >= buffer.length) break;
            crawlerPromises.push(processFunctionPrototype(buffer, state, uniqueStrings, vectors, p, sharedKnowledgeBase));
        }

        Promise.all(crawlerPromises).then((results) => {
            let output = `-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n\n`;

            // Core script structural assembly processing
            results.forEach(res => {
                if (res.code.length > 0) {
                    if (res.protoId === results.length - 1) {
                        output += `-- Main Thread Logic Script Execution Block\n`;
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
