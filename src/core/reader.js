class LuauBytecodeReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }

    readByte() { return this.buffer.readUInt8(this.offset++); }
    readInt32() {
        const val = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return val;
    }

    readVarInt() {
        let result = 0, shift = 0, byte;
        do {
            byte = this.readByte();
            result |= (byte & 0x7F) << shift;
            shift += 7;
        } while ((byte & 0x80) !== 0);
        return result;
    }

    readString() {
        const length = this.readVarInt();
        if (length === 0) return "";
        const str = this.buffer.toString('utf8', this.offset, this.offset + length);
        this.offset += length;
        return str;
    }

    parse() {
        const header = {
            version: this.readByte(),
            typesVersion: this.readByte(),
            strings: [null]
        };

        if (header.version === 0) throw new Error("Compilation failure bytecode token.");

        const stringCount = this.readVarInt();
        for (let i = 0; i < stringCount; i++) {
            header.strings.push(this.readString());
        }

        const protoCount = this.readVarInt();
        const protos = [];

        for (let i = 0; i < protoCount; i++) {
            protos.push(this.parseProto(header.strings));
        }

        const mainProtoIndex = this.readVarInt();
        return { header, protos, mainProtoIndex };
    }

    parseProto(stringTable) {
        const proto = {
            maxStackSize: this.readByte(),
            numParams: this.readByte(),
            numUpvalues: this.readByte(),
            isVararg: this.readByte(),
            instructions: [],
            constants: []
        };

        // Skip internal tracking structures if active
        if (this.buffer.readUInt8(this.offset) === 1) { this.offset += 5; } else { this.offset += 1; }

        const instructionCount = this.readVarInt();
        for (let i = 0; i < instructionCount; i++) {
            proto.instructions.push(this.readInt32());
        }

        const constantCount = this.readVarInt();
        for (let i = 0; i < constantCount; i++) {
            const type = this.readByte();
            let value = null;
            if (type === 1) value = (this.readByte() !== 0);
            else if (type === 2) { this.offset += 8; value = "NUMBER_PLACEHOLDER"; } // Float/Double storage bypass
            else if (type === 3) {
                const id = this.readVarInt();
                value = stringTable[id] || `str_${id}`;
            }
            proto.constants.push({ type, value });
        }

        const childProtoCount = this.readVarInt();
        proto.childProtos = [];
        for (let i = 0; i < childProtoCount; i++) {
            proto.childProtos.push(this.readVarInt());
        }

        // Strip execution debugging metadata tails
        this.readVarInt(); this.readVarInt();
        if (this.readVarInt() > 0) { this.readVarInt(); }

        return proto;
    }
}

module.exports = LuauBytecodeReader;
