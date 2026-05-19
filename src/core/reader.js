class LuauBytecodeReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }

    // Helper: Reads a compressed LEB128 variable-length integer
    readVarInt() {
        let result = 0;
        let shift = 0;
        let byte;
        
        do {
            byte = this.buffer.readUInt8(this.offset++);
            result |= (byte & 0x7F) << shift;
            shift += 7;
        } while ((byte & 0x80) !== 0);

        return result;
    }

    // Helper: Reads a string based on its length descriptor
    readString() {
        const length = this.readVarInt();
        if (length === 0) return "";
        
        const str = this.buffer.toString('utf8', this.offset, this.offset + length);
        this.offset += length;
        return str;
    }

    // Primary entry point for Phase 2
    parseHeader() {
        const header = {};

        // 1. Read Version Bytes
        header.bytecodeVersion = this.buffer.readUInt8(this.offset++);
        
        // Error check for compiler failure flags
        if (header.bytecodeVersion === 0) {
            throw new Error("Invalid bytecode payload (Compilation error flag triggered).");
        }
        
        header.typesVersion = this.buffer.readUInt8(this.offset++);

        // 2. Extract Global String Table
        header.stringTableSize = this.readVarInt();
        header.stringTable = [];
        
        // The first index [0] in Luau string tables is always a null placeholder
        header.stringTable.push(null); 

        for (let i = 0; i < header.stringTableSize; i++) {
            header.stringTable.push(this.readString());
        }

        // 3. Extract Total Prototype Count
        header.protoCount = this.readVarInt();

        return {
            header: header,
            nextOffset: this.offset // Pass this to the prototype parser module
        };
    }
}

module.exports = LuauBytecodeReader;
