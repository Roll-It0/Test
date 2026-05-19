const OP_CODES = require('./opcodes');

class LuauDisassembler {
    static disassemble(parsedData) {
        let output = "";
        parsedData.protos.forEach((proto, index) => {
            output += `; Prototype [${index}] | Params: ${proto.numParams} | Stack: ${proto.maxStackSize}\n`;
            
            proto.instructions.forEach((ins, pc) => {
                const opCodeNum = ins & 0xFF;
                const op = OP_CODES[opCodeNum] || { name: `UNKNOWN_${opCodeNum}`, format: "NONE" };
                
                const a = (ins >> 8) & 0xFF;
                const b = (ins >> 16) & 0xFF;
                const c = (ins >> 24) & 0xFF;
                const bx = (ins >> 16) & 0xFFFF;
                const sbx = bx - 0x7FFF;

                let args = "";
                if (op.format === "A") args = `${a}`;
                else if (op.format === "AB") args = `${a} ${b}`;
                else if (op.format === "ABC") args = `${a} ${b} ${c}`;
                else if (op.format === "ABx") {
                    let kContext = "";
                    if ((op.name === "LOADK" || op.name === "GETGLOBAL" || op.name === "SETGLOBAL") && proto.constants[bx]) {
                        kContext = ` ; '${proto.constants[bx].value}'`;
                    }
                    args = `${a} ${bx}${kContext}`;
                } else if (op.format === "sBx") args = `${sbx}`;
                else if (op.format === "AsBx") args = `${a} ${sbx}`;

                output += `  [${pc.toString().padStart(3, '0')}] ${op.name.padEnd(12)} ${args}\n`;
            });
            output += "\n";
        });
        return output;
    }
}

module.exports = LuauDisassembler;
