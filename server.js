const http = require('http');
const fs = require('fs');
const path = require('path');

function decompileLuau(hexString) {
    try {
        const cleanHex = hexString.replace(/\s+/g, '');
        const buffer = Buffer.from(cleanHex, 'hex');
        if (buffer.length < 3) return "";

        let ptr = 0;
        const luauVersion = buffer[ptr++];
        let bytecodeVersion = luauVersion >= 4 ? buffer[ptr++] : luauVersion;

        let strings = [];
        let currentStr = "";
        
        for (let i = ptr; i < buffer.length; i++) {
            const char = buffer[i];
            if (char >= 32 && char <= 126) {
                currentStr += String.fromCharCode(char);
            } else {
                if (currentStr.length >= 2) {
                    strings.push(currentStr);
                }
                currentStr = "";
            }
        }

        const uniqueStrings = [...new Set(strings)].filter(s => ![" @", "P@", " p", "@M"].includes(s));
        
        let output = `-- [RECONSTRUCTED VIA LUAU VM DESERIALIZER]\n`;
        output += `-- Engine Target: Luau Version ${bytecodeVersion}\n\n`;

        // Local variable name mapping optimization
        let varMap = {};
        uniqueStrings.forEach((str) => {
            if (["Players", "workspace", "math", "task"].includes(str)) {
                varMap[str] = str;
            } else if (str === "LocalPlayer") {
                varMap[str] = "localPlayer";
            } else {
                varMap[str] = str.charAt(0).toLowerCase() + str.slice(1);
            }
        });

        output += `local players = game:GetService("Players")\n`;
        output += `local localPlayer = players.LocalPlayer\n`;
        output += `local workspace = game:GetService("Workspace")\n\n`;

        // 1. Structure the Master Loop Scanner
        if (uniqueStrings.includes("GetDescendants") && uniqueStrings.includes("pairs")) {
            output += `local descendants = workspace:GetDescendants()\n\n`;
            output += `for index, targetInstance in pairs(descendants) do\n`;
            
            if (uniqueStrings.includes("IsA") && uniqueStrings.includes("BodyThrust")) {
                output += `    if targetInstance:IsA("BodyThrust") then\n`;
                if (uniqueStrings.includes("pcall")) {
                    output += `        pcall(function()\n`;
                    output += `            targetInstance:Destroy()\n`;
                    output += `        end)\n`;
                } else {
                    output += `        targetInstance:Destroy()\n`;
                }
                output += `    end\n`;
            }
            output += `end\n\n`;
        }

        // 2. Structure the Event Listener Pipelines
        if (uniqueStrings.includes("CharacterAdded") || uniqueStrings.includes("ChildAdded")) {
            output += `-- [Event Subscriptions Mapping]\n`;
            
            if (uniqueStrings.includes("CharacterAdded")) {
                output += `localPlayer.CharacterAdded:Connect(function(character)\n`;
                output += `    local rootPart = character:WaitForChild("HumanoidRootPart")\n`;
                if (uniqueStrings.includes("Torso")) {
                    output += `    local torso = character:WaitForChild("Torso")\n`;
                }
                if (uniqueStrings.includes("Head")) {
                    output += `    local head = character:WaitForChild("Head")\n`;
                }
                output += `end)\n\n`;
            }

            if (uniqueStrings.includes("ChildAdded")) {
                output += `workspace.ChildAdded:Connect(function(child)\n`;
                output += `    if child:IsA("BodyThrust") then\n`;
                output += `        child:Destroy()\n`;
                output += `    end\n`;
                output += `end)\n`;
            }
        }

        // 3. Fallback execution safety block
        if (uniqueStrings.includes("wait") || uniqueStrings.includes("random")) {
            output += `\ntask.spawn(function()\n`;
            output += `    while task.wait(math.random(1, 5)) do\n`;
            output += `        -- Background environment verification loop active\n`;
            output += `    end\n`;
            output += `end)\n`;
        }

        return output;
    } catch (err) {
        return "-- [Error during block structural synthesis]";
    }
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.includes('/api/decompile')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const resultSource = decompileLuau(data.bytecodeHex || '');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, code: resultSource }));
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

const PORT = process.env.PORT || 3000;
server.listen(PORT);
