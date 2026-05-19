const OP_CODES = require('./opcodes');

class LuauDecompiler {
    static decompile(parsedData) {
        let luaCode = "-- Decompiled with Web API Backend\n\n";
        
        parsedData.protos.forEach((proto, pId) => {
            const lines = [];
            const registers = {};
            
            proto.instructions.forEach((ins) => {
                const opCodeNum = ins & 0xFF;
                const op = OP_CODES[opCodeNum] || { name: "UNKNOWN" };
                const a = (ins >> 8) & 0xFF;
                const bx = (ins >> 16) & 0xFFFF;

                if (op.name === "LOADK" && proto.constants[bx]) {
                    registers[a] = `"${proto.constants[bx].value}"`;
                } else if (op.name === "GETGLOBAL" && proto.constants[bx]) {
                    registers[a] = `${proto.constants[bx].value}`;
                } else if (op.name === "CALL") {
                    const funcName = registers[a] || `var_${a}`;
                    lines.push(`${funcName}()`);
                }
            });

            if (lines.length > 0) {
                luaCode += `-- Function Proto [${pId}]\n` + lines.join("\n") + "\n\n";
            }
        });

        return luaCode === "-- Decompiled with Web API Backend\n\n" ? "-- No executable operations mapped." : luaCode;
    }
}

module.exports = LuauDecompiler;
