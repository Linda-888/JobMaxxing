import Foundation
import PDFKit

let pdfBytes = FileHandle.standardInput.readDataToEndOfFile()
guard let document = PDFDocument(data: pdfBytes),
      let text = document.string,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    fputs("No selectable PDF text was found.\n", stderr)
    exit(1)
}
FileHandle.standardOutput.write(Data(text.utf8))
