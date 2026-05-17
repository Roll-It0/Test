const http = require('http');
const fs = require('fs');
const path = require('path');

const services = new Set([
    "Players", "Workspace", "ReplicatedStorage", "ServerScriptService", 
    "ServerStorage", "HttpService", "TweenService", "LogService", 
    "UserInputService", "RunService", "Lighting", "SoundService", 
    "Teams", "MarketplaceService", "TeleportService", "DataStoreService"
]);

const physics = new Set([
    "BodyThrust", "BodyVelocity", "RocketPropulsion", "BodyAngularVelocity", 
    "BodyPosition", "BodyGyro", "LinearVelocity", "AngularVelocity", "VectorForce"
]);

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

function spawnCrawler(slice, stringTable, crawlerId, sharedKnowledgeBase) {
    return new Promise((resolve) => {
        let localRegisters = {};
        let ptr = 0;

        while (ptr < slice.length) {
            if (ptr + 4 > slice.length) break;
            
            const op = slice[ptr];
            const rA = slice[ptr + 1];
            const rB = slice[ptr + 2];
            const rC = slice[ptr + 3];
            ptr += 4;

            if (op === 0xA4) { 
                const kIdx = rB;
                if (stringTable[kIdx]) {
                    localRegisters[rA] = stringTable[kIdx];
                    if (services.has(stringTable[kIdx])) {
                        sharedKnowledgeBase.services.add(stringTable[kIdx]);
                    }
                }
            } 
            else if (op === 0x9F) { 
                const kIdx = rB;
                if (stringTable[kIdx]) {
                    localRegisters[rA] = stringTable[kIdx];
                    if (physics.has(stringTable[kIdx])) {
                        sharedKnowledgeBase.physics.add(stringTable[kIdx]);
                    }
                }
            }
            else if (op === 0x52) { 
                const method = stringTable[rC];
                const target = localRegisters[rB];
                if (method && target) {
                    if (method === "GetService") {
                        sharedKnowledgeBase.services.add(target);
                    }
                }
            }
        }
        resolve({ crawlerId, registers: localRegisters });
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

        const crawlerCount = 100;
        const chunkSize = Math.ceil(totalInstructionsSize / crawlerCount);
        let crawlerPromises = [];
        let sharedKnowledgeBase = { services: new Set(), physics: new Set() };

        for (let i = 0; i < crawlerCount; i++) {
            const startIdx = instructionStart + (i * chunkSize);
            const endIdx = Math.min(buffer.length, startIdx + chunkSize);
            if (startIdx >= buffer.length) break;

            const slice = buffer.subarray(startIdx, endIdx);
            crawlerPromises.push(spawnCrawler(slice, uniqueStrings, i, sharedKnowledgeBase));
        }

        Promise.all(crawlerPromises).then(() => {
            let output = `-- Bytecode Version ${bytecodeVersion} | Length ${buffer.length} bytes\n\n`;

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
                output += `end)\n\n`;
            }

            if (uniqueStrings.includes("ChildAdded")) {
                output += `workspace.ChildAdded:Connect(function(child)\n`;
                if (sharedKnowledgeBase.physics.size > 0) {
                    const childConditions = [...sharedKnowledgeBase.physics].map(p => `child:IsA("${p}")`).join(" or ");
                    output += `    if ${childConditions} then\n        child:Destroy()\n    end\n`;
                }
                output += `end)\n\n`;
            }

            if (uniqueStrings.includes("wait") || uniqueStrings.includes("random")) {
                let low = numericConstants[0] || 1;
                let high = numericConstants[1] || 5;
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
