export class FilesSerializer {

    private buffer : Uint8Array = new Uint8Array(1);
    private length : number = 0;


    /**
     * @brief Add a file to the serialized files
     * @param name Name of the file
     * @param content Content of the file or null for a directory
    **/
    public add(name: string, content: Uint8Array | null) {
        // Resize buffer if needed
        while (this.length + name.length + 5 + (content ? content.length : 0) > this.buffer.byteLength) {
            const newBuffer = new Uint8Array(this.buffer.byteLength * 2);
            newBuffer.set(this.buffer);
            this.buffer = newBuffer;
        }

        // Add name (null terminated)
        for (let i = 0; i < name.length; i++) {
            this.buffer[this.length++] = name.charCodeAt(i);
        }
        this.buffer[this.length++] = 0;

        // Add content (length, data)
        const view = new DataView(this.buffer.buffer);
        view.setInt32(this.length, content ? content.length : -1);
        this.length += 4;
        if (content) {
            this.buffer.set(content, this.length);
            this.length += content.length;
        }
    }


    /**
     * @brief Get the serialized files
    **/
    public get() : Uint8Array {
        return this.buffer.slice(0, this.length);
    }

}



export class FilesDeserializer implements Iterable<File> {

    public constructor(private buffer: Uint8Array) {}

    public* [Symbol.iterator]() : Iterator<File> {
        let index = 0;
        while (index < this.buffer.length) {
            // Read name (null terminated)
            let name = "";
            while (index < this.buffer.length && this.buffer[index] !== 0) {
                name += String.fromCharCode(this.buffer[index++]);
            }
            index++;

            // Read content (length, data)
            const view = new DataView(this.buffer.buffer);
            const length = view.getInt32(index);
            index += 4;
            let content;
            if (length === -1) { // Directory
                content = null;
            }
            else { // File
                content = this.buffer.slice(index, index + length);
                index += length;
            }

            yield new File(name, content);
        }
    }

}



export class File {
    public constructor(public name: string, public content: Uint8Array | null) {}
}