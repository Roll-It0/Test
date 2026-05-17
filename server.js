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
        let bytecodeVersion = 0;
        if (luauVersion >= 4) {
            bytecodeVersion = buffer[ptr++];
        } else {
            bytecodeVersion = luauVersion; 
        }
        let output = "";
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
        const uniqueStrings = [...new Set(strings)];
        output += "local Constants = {\n";
        uniqueStrings.forEach((str, idx) => {
            output += `    [${idx + 1}] = "${str}",\n`;
        });
        output += "}\n\n";
        output += "function Main(...)\n";
        let stringIdx = 0;
        uniqueStrings.forEach(str => {
            if (str.length > 4 && !["math", "pairs", "pcall", "task", "wait"].includes(str)) {
                output += `    local var_${stringIdx} = game.${str}\n`;
                stringIdx++;
            }
        });
        output += "end\n";
        return output;
    } catch (err) {
        return "";
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
        res.end('Method Not Allowed');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT);
