import { Buffer } from "buffer";

/**
 * @brief Check if a file is binary
 * @param content Content of the file
**/
export function isBinary(content: Uint8Array) : boolean {
    let lineEnding = false; // true if line ending was found
    let carriageReturn = false; // true if line ending is \r\n
    for (let i = 0; i < content.length; i++) {
        // Special characters
        if (content[i] === 0) { // null byte
            return true;
        }
        else if (content[i] === 13) { // \r
            if (i + 1 < content.length && content[i + 1] === 10) { // \r\n
                if (lineEnding) {
                    if (!carriageReturn) { // Mixed line endings
                        return true;
                    }
                }
                else {
                    lineEnding = true;
                    carriageReturn = true;
                }
                i++;
            }
            else { // Invalid \r
                return true;
            }
        }
        else if (content[i] === 10) { // \n
            if (lineEnding) {
                if (carriageReturn) { // Mixed line endings
                    return true;
                }
            }
            else {
                lineEnding = true;
                carriageReturn = false;
            }
        }

        // UTF-8
        if (content[i] >> 5 === 0b110) { // 2 bytes
            if (!(i + 1 < content.length && content[i + 1] >> 6 === 0b10 && // Invalid next byte
                (content[i] & 0b00011110) !== 0)) { // Should be 1 byte
                return true;
            }
        }
        else if (content[i] >> 4 === 0b1110) { // 3 bytes
            if (!(i + 2 < content.length && content[i + 1] >> 6 === 0b10 && content[i + 2] >> 6 === 0b10 && // Invalid next bytes
                ((content[i] & 0b00001111) !== 0 || (content[i + 1] & 0b00100000) !== 0))) { // Should be 1 or 2 bytes
                return true;
            }
        }
        else if (content[i] >> 3 === 0b11110) { // 4 bytes
            if (!(i + 3 < content.length && content[i + 1] >> 6 === 0b10 && content[i + 2] >> 6 === 0b10 && content[i + 3] >> 6 === 0b10 && // Invalid next bytes
                ((content[i] & 0b00000111) !== 0 || (content[i + 1] & 0b00110000) !== 0))) { // Should be 1, 2 or 3 bytes
                return true;
            }
        }
    }

    return false;
}


/**
 * @brief Encode a binary file using base64
 * @param content Content of the file
 * @returns Base64 string
**/
export function toBase64(content: Uint8Array) : string {
    return Buffer.from(content).toString("base64");
}


/**
 * @brief Decode a base64 string to a binary file
 * @param content Base64 string
 * @returns Content of the file
**/
export function fromBase64(content: string) : Uint8Array {
    return new Uint8Array(Buffer.from(content, "base64"));
}