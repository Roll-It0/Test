const http = require('http');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

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

if (!isMainThread) {
    const { slice, stringTable, crawlerId } = workerData;
    const buffer = Buffer.from(slice);
    let crawlerOutput = "";
    let localRegisters = {};
    let unresolvedHints = [];

    let ptr = 0;
    while (ptr < buffer.length) {
        if (ptr + 4 > buffer.length) break;
        
        const op = buffer[ptr];
        const rA = buffer[ptr + 1];
        const rB = buffer[ptr + 2];
        const rC = buffer[ptr + 3];
        ptr += 4;

        if (op === 0xA4) { 
            const kIdx = rB;
            if (stringTable[kIdx]) {
                localRegisters[rA] = stringTable[kIdx];
                if (stringTable[kIdx] === "game") {
                    // Base declaration layer caught by crawler
                }
            }
        } 
        else if (op === 0x9F) { 
            const kIdx = rB;
            if (stringTable[kIdx]) {
                localRegisters[rA] = `"${stringTable[kIdx]}"`;
            }
        }
        else if (op === 0x52) { 
            const method = stringTable[rC];
            const target = localRegisters[rB];
            if (method && target) {
                if (method === "GetService") {
                    unresolvedHints.push({ type: "SERVICE", reg: rA, value: target });
                } else {
                    localRegisters[rA] = `${target}:${method}()`;
                }
            }
        }
    }

    parentPort.postMessage({
        crawlerId: crawlerId,
        registers: localRegisters,
        hints: unresolvedHints,
        rawOutput: crawlerOutput
    });
    process.exit(0);
}

function processController(hexString, callback) {
    try {
        const cleanHex = hexString.replace(/\s+/g, '');
        if (!cleanHex || cleanHex.length % 2 !== 0) return callback("-- Error: Malformed hex");
        
        const buffer = Buffer.from(cleanHex, 'hex');
        if (buffer.length < 4) return callback("-- Error: Input too small");

        let state = { ptr: 0 };
        const luauVersion = buffer[state.ptr++];
        const bytecodeVersion = luauVersion >= 4 ? buffer[state.ptr++] : luauVersion;

        const stringCount = readVarint(buffer, state);
        let stringTable = [];
        
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
            }
        }

        const uniqueStrings = [...new Set(stringTable)];
        const instructionStart = state.ptr;
        const totalInstructionsSize = buffer.length - instructionStart;
        
        if (totalInstructionsSize <= 0) {
            return callback(`-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n`);
        }

        const crawlerCount = Math.min(100, Math.max(1, Math.ceil(totalInstructionsSize / 16)));
        const chunkSize = Math.ceil(totalInstructionsSize / crawlerCount);

        let activeWorkers = crawlerCount;
        let masterResults = new Array(crawlerCount);
        let sharedKnowledgeBase = { services: new Set(), objects: new Set() };

        for (let i = 0; i < crawlerCount; i++) {
            const startIdx = instructionStart + (i * chunkSize);
            const endIdx = Math.min(buffer.length, startIdx + chunkSize);
            if (startIdx >= buffer.length) {
                activeWorkers--;
                continue;
            }

            const slice = buffer.subarray(startIdx, endIdx);
            const worker = new Worker(__filename, {
                workerData: {
                    slice: slice,
                    stringTable: uniqueStrings,
                    crawlerId: i
                }
            });

            worker.on('message', (msg) => {
                masterResults[msg.crawlerId] = msg;
                msg.hints.forEach(hint => {
                    if (hint.type === "SERVICE") {
                        sharedKnowledgeBase.services.add(hint.value);
                    }
                });

                activeWorkers--;
                if (activeWorkers === 0) {
                    assembleFinalOutput();
                }
            });

            worker.on('error', () => {
                activeWorkers--;
                if (activeWorkers === 0) assembleFinalOutput();
            });
        }

        function assembleFinalOutput() {
            let finalCode = `-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n\n`;
            
            uniqueStrings.forEach(str => {
                if (str.endsWith("Service") || str === "Players") {
                    const varName = str.charAt(0).toLowerCase() + str.slice(1);
                    finalCode += `local ${varName} = game:GetService("${str}")\n`;
                }
            });
            
            if (uniqueStrings.includes("Workspace") || uniqueStrings.includes("workspace")) {
                finalCode += `local workspace = game:GetService("Workspace")\n`;
            }
            if (uniqueStrings.includes("Players")) {
                finalCode += `local localPlayer = players.LocalPlayer\n`;
            }
            
            finalCode += "\n";

            if (uniqueStrings.includes("GetDescendants") && uniqueStrings.includes("pairs")) {
                finalCode += `for _, instance in pairs(workspace:GetDescendants()) do\n`;
                let targets = uniqueStrings.filter(s => s.startsWith("Body") || s.endsWith("Velocity") || s.endsWith("Force"));
                if (targets.length > 0) {
                    const conditions = targets.map(t => `instance:IsA("${t}")`).join(" or ");
                    finalCode += `    if ${conditions} then\n`;
                    if (uniqueStrings.includes("pcall")) {
                        finalCode += `        pcall(function()\n            instance:Destroy()\n        end)\n`;
                    } else {
                        finalCode += `        instance:Destroy()\n`;
                    }
                    finalCode += `    end\n`;
                }
                finalCode += `end\n\n`;
            }

            if (uniqueStrings.includes("CharacterAdded")) {
                finalCode += `localPlayer.CharacterAdded:Connect(function(character)\n`;
                ["HumanoidRootPart", "Torso", "Head"].forEach(part => {
                    if (uniqueStrings.includes(part)) {
                        finalCode += `    local ${part.charAt(0).toLowerCase() + part.slice(1)} = character:WaitForChild("${part}")\n`;
                    }
                });
                finalCode += `end)\n\n`;
            }

            if (uniqueStrings.includes("ChildAdded")) {
                finalCode += `workspace.ChildAdded:Connect(function(child)\n`;
                let targets = uniqueStrings.filter(s => s.startsWith("Body") || s.endsWith("Velocity") || s.endsWith("Force"));
                if (targets.length > 0) {
                    const conditions = targets.map(t => `child:IsA("${t}")`).join(" or ");
                    finalCode += `    if ${conditions} then\n        child:Destroy()\n    end\n`;
                }
                finalCode += `end)\n\n`;
            }

            if (uniqueStrings.includes("wait") || uniqueStrings.includes("random")) {
                let low = 1;
                let high = 5;
                finalCode += `task.spawn(function()\n`;
                finalCode += `    while task.wait(math.random(${low}, ${high})) do\n`;
                finalCode += `    end\n`;
                finalCode += `end)\n`;
            }

            callback(finalCode);
        }
    } catch (err) {
        callback("-- Error: Assembly failure");
    }
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.includes('/api/decompile')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                processController(data.bytecodeHex || '', (resultSource) => {
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
