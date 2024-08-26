export class FilesSerializer {

    private buffer : Uint8Array = new Uint8Array(1);
    private length : number = 0;


    /**
     * @brief Add a file to the files to be serialized
     * @param name Name of the file
     * @param content Content of the file
    **/
    public add(name: string, content: Uint8Array) {
        // Resize buffer if needed
        while (this.length + content.length > this.buffer.byteLength) {
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
        view.setUint32(this.length, content.length);
        this.length += 4;
        this.buffer.set(content, this.length);
        this.length += content.length;
    }


    /**
     * @brief Serialize the files that were added
     * @return Serialized files
    **/
    public serialize() : Uint8Array {
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
            const length = view.getUint32(index);
            index += 4;
            const content = this.buffer.slice(index, index + length);
            index += length;

            yield new File(name, content);
        }
    }

}



export class File {
    public constructor(public name: string, public content: Uint8Array) {}
}