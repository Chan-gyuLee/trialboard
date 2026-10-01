"""Private resource-limited parser subprocess. No provider, network, or filesystem input."""

import errno
import io
import json
import mmap
import resource
import sys

MEMORY_BYTES = 536_870_912
MAX_OUTPUT = 200_000


def sandbox():
    # Darwin RLIMIT_AS is not a reliable supported boundary for this workflow.
    if sys.platform != "linux":
        raise ValueError("UNSUPPORTED_SANDBOX")
    try:
        for name, limit in ((resource.RLIMIT_AS, MEMORY_BYTES), (resource.RLIMIT_CPU, 2),
                            (resource.RLIMIT_FSIZE, MAX_OUTPUT), (resource.RLIMIT_NOFILE, 32)):
            resource.setrlimit(name, (limit, limit))
            if resource.getrlimit(name) != (limit, limit):
                raise ValueError("UNSUPPORTED_SANDBOX")
        try:
            mapping = mmap.mmap(-1, MEMORY_BYTES)
        except OSError as error:
            if error.errno != errno.ENOMEM:
                raise ValueError("UNSUPPORTED_SANDBOX") from None
        except MemoryError:
            pass  # Current address space + this allocation must exceed RLIMIT_AS.
        else:
            mapping.close()
            raise ValueError("UNSUPPORTED_SANDBOX")
    except (OSError, ValueError):
        raise ValueError("UNSUPPORTED_SANDBOX") from None


def extract(raw):
    import pdfplumber  # Import only AFTER successful sandbox setup in main().

    if not 5 <= len(raw) <= 5_000_000 or not raw.startswith(b"%PDF-"):
        raise ValueError("PDF_PARSE_FAILED")
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        if pdf.doc.encryption:
            raise ValueError("PDF_ENCRYPTED_UNSUPPORTED")
        if not 1 <= len(pdf.pages) <= 10:
            raise ValueError("PDF_PAGE_LIMIT")
        pages, count = [], 0
        for number, page in enumerate(pdf.pages, 1):
            value = page.extract_text() or ""
            count += len(value)
            if count > 30_000:
                raise ValueError("PDF_TEXT_LIMIT")
            pages.append({"page": number, "text": value})
        if not any(p["text"].strip() for p in pages):
            raise ValueError("PDF_TEXT_UNAVAILABLE")
        return {"extractor": f"pdfplumber/{pdfplumber.__version__}", "pages": pages}


def main():
    try:
        sandbox()
        raw = sys.stdin.buffer.read(5_000_001)
        value = {"status": "OK", **extract(raw)}
    except Exception as error:
        allowed = {"UNSUPPORTED_SANDBOX", "PDF_ENCRYPTED_UNSUPPORTED", "PDF_PAGE_LIMIT",
                   "PDF_TEXT_LIMIT", "PDF_TEXT_UNAVAILABLE", "PDF_PARSE_FAILED"}
        code = str(error) if str(error) in allowed else "PDF_PARSE_FAILED"
        if type(error).__name__ == "PDFPasswordIncorrect":
            code = "PDF_ENCRYPTED_UNSUPPORTED"
        value = {"status": "ERROR", "code": code}
    output = json.dumps(value, ensure_ascii=False).encode("utf-8")
    if len(output) > MAX_OUTPUT:
        output = b'{"status":"ERROR","code":"PDF_OUTPUT_LIMIT"}'
    sys.stdout.buffer.write(output)


if __name__ == "__main__":
    main()
