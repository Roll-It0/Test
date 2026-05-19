// src/server.js
const http = require('http');
const LuauBytecodeReader = require('./core/reader');
const LuauDisassembler = require('./core/disassembler');
const LuauDecompiler = require('./core/decompiler');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    // 1. Force global CORS headers so the executor isn't blocked
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Accept');

    // 2. Safely resolve pre-flight OPTIONS requests sent by exploit environments
    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    // 3. Main processing path
    if (req.url === '/decompile') {
        if (req.method !== 'POST') {
            res.statusCode = 405;
            return res.end(JSON.stringify({ error: "Method Not Allowed. Use POST." }));
        }

        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body);
                if (!parsed.bytecode) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: "Missing 'bytecode' parameter payload." }));
                }

                const binaryBuffer = Buffer.from(parsed.bytecode, 'base64');
                const reader = new LuauBytecodeReader(binaryBuffer);
                const rawAST = reader.parse();
                
                const disassemblyResult = LuauDisassembler.disassemble(rawAST);
                const decompiledResult = LuauDecompiler.decompile(rawAST);

                res.statusCode = 200;
                res.end(JSON.stringify({
                    disassembly: disassemblyResult,
                    decompiled: decompiledResult
                }));

            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: "Pipeline Parsing Exception Raised: " + err.message }));
            }
        });
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Endpoint Route Invalid." }));
    }
});

server.listen(PORT, () => {
    console.log(`Production API Server operational via port ${PORT}`);
});
