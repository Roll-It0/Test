const http = require('http');
const fs = require('fs');
const path = require('path');

const opcodeVectors = {
    3: { getGlobal: 0xA4, loadK: 0x9F, nameCall: 0x52, close: 0x1E, jump: 0x4D, getUpvalue: 0x12, setUpvalue: 0x13, jmpIf: 0x4E, jmpIfNot: 0x4F },
    4: { getGlobal: 0xB2, loadK: 0xA1, nameCall: 0x58, close: 0x22, jump: 0x51, getUpvalue: 0x15, setUpvalue: 0x16, jmpIf: 0x52, jmpIfNot: 0x53 },
    5: { getGlobal: 0xC1, loadK: 0xB5, nameCall: 0x61, close: 0x2A, jump: 0x5D, getUpvalue: 0x19, setUpvalue: 0x1A, jmpIf: 0x5E, jmpIfNot: 0x5F },
    6: { getGlobal: 0xD4, loadK: 0xC2, nameCall: 0x6E, close: 0x31, jump: 0x65, getUpvalue: 0x20, setUpvalue: 0x21, jmpIf: 0x66, jmpIfNot: 0x67 }
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

function spawnUpvalueCrawler(slice, stringTable, vectors, sharedKnowledgeBase) {
    return new Promise((resolve) => {
        let ptr = 0;
        while (ptr < slice.length) {
            if (ptr + 4 > slice.length) break;
            const op = slice[ptr];
            const rA = slice[ptr + 1];
            const rB = slice[ptr + 2];
            ptr += 4;
            if (op === vectors.getUpvalue) {
                sharedKnowledgeBase.upvalues[rB] = { index: rB, boundRegister: rA, scope: "parent" };
                sharedKnowledgeBase.hints.push({ type: "UPVALUE_BIND", upvalueIndex: rB, register: rA });
            } else if (op === vectors.setUpvalue) {
                sharedKnowledgeBase.hints.push({ type: "UPVALUE_MUTATE", upvalueIndex: rB, valueFromRegister: rA });
            }
        }
        resolve();
    });
}

function spawnFunctionCrawler(slice, stringTable, vectors, sharedKnowledgeBase) {
    return new Promise((resolve) => {
        let ptr = 0;
        while (ptr < slice.length) {
            if (ptr + 4 > slice.length) break;
            const op = slice[ptr];
            const rA = slice[ptr + 1];
            const rB = slice[ptr + 2];
            const rC = slice[ptr + 3];
            ptr += 4;

            if (op === vectors.getGlobal || op === vectors.loadK) {
                if (stringTable[rB]) {
                    sharedKnowledgeBase.registers[rA] = stringTable[rB];
                }
            } else if (op === vectors.nameCall) {
                const method = stringTable[rC];
                const target = sharedKnowledgeBase.registers[rB];
                if (method && target) {
                    sharedKnowledgeBase.hints.push({ type: "CALL", target: target, method: method, dest: rA });
                }
            } else if (op === vectors.jmpIf || op === vectors.jmpIfNot) {
                const conditionVar = sharedKnowledgeBase.registers[rA] || "condition";
                sharedKnowledgeBase.hints.push({ type: "CONDITIONAL_BRANCH", variable: conditionVar, mode: op === vectors.jmpIf ? "if" : "ifNot" });
            }
        }
        resolve();
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
        let numericConstants = [];
        let currentStr = "";
        
        for (let i = state.ptr; i < buffer.length; i++) {
            const byte = buffer[i];
            if (byte >= 32 && byte <= 126) {
                currentStr += String.fromCharCode(byte);
            } else {
                if (currentStr.length >= 2 && !/^[ @PMp]+$/.test(currentStr)) {
                    stringTable.push(currentStr);
                }
                currentStr = "";
                if (byte > 0 && byte <= 120 && buffer[i+1] === 0) {
                    numericConstants.push(byte);
                }
            }
        }

        const uniqueStrings = [...new Set(stringTable)];
        const instructionStart = state.ptr;
        const totalInstructionsSize = buffer.length - instructionStart;
        
        if (totalInstructionsSize <= 0) {
            return callback(`-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n`);
        }

        const alignedStart = instructionStart + (4 - (instructionStart % 4)) % 4;
        const processBuffer = buffer.subarray(alignedStart);

        let sharedKnowledgeBase = { registers: {}, upvalues: {}, hints: [], services: new Set(), physics: new Set() };
        
        const segmentSize = Math.floor(processBuffer.length / 2);
        const upvalueSlice = processBuffer.subarray(0, segmentSize);
        const functionSlice = processBuffer.subarray(segmentSize);

        Promise.all([
            spawnUpvalueCrawler(upvalueSlice, uniqueStrings, vectors, sharedKnowledgeBase),
            spawnFunctionCrawler(functionSlice, uniqueStrings, vectors, sharedKnowledgeBase)
        ]).then(() => {
            let output = `-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n\n`;

            uniqueStrings.forEach(str => {
                if (str.endsWith("Service") || str === "Players") {
                    sharedKnowledgeBase.services.add(str);
                } else if (str.startsWith("Body") || str.endsWith("Velocity") || str.endsWith("Force")) {
                    sharedKnowledgeBase.physics.add(str);
                }
            });

            if (sharedKnowledgeBase.services.size === 0) {
                sharedKnowledgeBase.services.add("Players");
                sharedKnowledgeBase.services.add("Workspace");
            }

            sharedKnowledgeBase.services.forEach(service => {
                const varName = service.charAt(0).toLowerCase() + service.slice(1);
                output += `local ${varName} = game:GetService("${service}")\n`;
            });
            
            if (!sharedKnowledgeBase.services.has("Workspace")) output += `local workspace = game:GetService("Workspace")\n`;
            output += `local localPlayer = players.LocalPlayer\n\n`;

            let processingCondition = false;
            sharedKnowledgeBase.hints.forEach(hint => {
                if (hint.type === "CONDITIONAL_BRANCH") {
                    processingCondition = true;
                }
            });

            if (uniqueStrings.includes("GetDescendants") && uniqueStrings.includes("pairs")) {
                output += `for _, instance in pairs(workspace:GetDescendants()) do\n`;
                if (sharedKnowledgeBase.physics.size > 0) {
                    const conditions = [...sharedKnowledgeBase.physics].map(p => `instance:IsA("${p}")`).join(" or ");
                    output += `    if ${conditions} then\n`;
                    if (uniqueStrings.includes("pcall")) {
                        output += `        pcall(function()\n            instance:Destroy()\n        end)\n`;
                    } else {
                        output += `        instance:Destroy()\n`;
                    }
                    output += `    end\n`;
                }
                output += `end\n\n`;
            }

            if (uniqueStrings.includes("CharacterAdded")) {
                output += `localPlayer.CharacterAdded:Connect(function(character)\n`;
                ["HumanoidRootPart", "Torso", "Head"].forEach(part => {
                    if (uniqueStrings.includes(part)) {
                        output += `    local ${part.charAt(0).toLowerCase() + part.slice(1)} = character:WaitForChild("${part}")\n`;
                    }
                });
                
                let boundUpvalueStr = "";
                Object.keys(sharedKnowledgeBase.upvalues).forEach(key => {
                    boundUpvalueStr += `    upvalue_${key} = character\n`;
                });
                if (boundUpvalueStr !== "") {
                    output += boundUpvalueStr;
                }

                output += `end)\n\n`;
            }

            if (uniqueStrings.includes("ChildAdded")) {
                output += `workspace.ChildAdded:Connect(function(child)\n`;
                if (sharedKnowledgeBase.physics.size > 0) {
                    const childConditions = [...sharedKnowledgeBase.physics].map(p => `child:IsA("${p}")`).join(" or ");
                    if (processingCondition) {
                        output += `    if ${childConditions} then\n        child:Destroy()\n    else\n        -- Alternative block path branch active\n    end\n`;
                    } else {
                        output += `    if ${childConditions} then\n        child:Destroy()\n    end\n`;
                    }
                }
                output += `end)\n\n`;
            }

            if (uniqueStrings.includes("wait") || uniqueStrings.includes("random")) {
                let low = numericConstants || 1;
                let high = numericConstants || 5;
                if (low >= high) { low = 1; high = 5; }

                output += `task.spawn(function()\n`;
                output += `    while task.wait(math.random(${low}, ${high})) do\n`;
                output += `    end\n`;
                output += `end)\n`;
            }

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
