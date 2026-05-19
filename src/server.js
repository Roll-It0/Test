const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    // Ensure all responses are JSON and allow API access
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'POST' && req.url === '/decompile') {
        let body = '';

        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body);
                if (!parsed.bytecode) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: "Missing 'bytecode' field in JSON." }));
                }

                // Decode Base64 string back into a Node.js binary Buffer
                const binaryBytecode = Buffer.from(parsed.bytecode, 'base64');

                // TODO: Pass binaryBytecode to your core modules
                // const disassembly = disassembler.run(binaryBytecode);
                // const decompiled = decompiler.run(disassembly);

                res.statusCode = 200;
                res.end(JSON.stringify({
                    disassembly: "; Disassembly placeholder for binary length: " + binaryBytecode.length,
                    decompiled: "-- Decompiler placeholder\nprint('Hello from API')"
                }));

            } catch (err) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Invalid JSON format or bad payload." }));
            }
        });
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Endpoint not found. Use POST /decompile" }));
    }
});

server.listen(PORT, () => {
    console.log(`API Service running on port ${PORT}`);
});
