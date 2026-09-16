"""Generate an unmistakably synthetic, renderable PDF for workflow rehearsals."""

from pathlib import Path
from tempfile import mkdtemp

from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas

from trialboard.agent.example import demo_input


def main():
    root = Path("output/pdf")
    root.mkdir(parents=True, exist_ok=True)
    folder = Path(mkdtemp(prefix="design-demo-", dir=root))
    target = folder / "SYNTHETIC-DEMO-NOT-CLINICAL.pdf"
    canvas = Canvas(str(target), pagesize=(1080, 720), invariant=1)
    canvas.setTitle("TrialBoard synthetic workflow fixture - NOT clinical evidence")
    canvas.setFillColorRGB(0.13, 0.2, 0.28)
    canvas.setFont("Helvetica-Bold", 26)
    canvas.drawString(48, 660, "TrialBoard / SYNTHETIC WORKFLOW DEMO")
    canvas.setFont("Helvetica-Bold", 13)
    canvas.setFillColorRGB(0.65, 0.22, 0.10)
    canvas.drawString(48, 625, "NOT A CLINICAL STUDY. NOT HUMAN OR EXPERT REVIEW.")
    canvas.setFillColorRGB(0.3, 0.37, 0.44)
    canvas.setFont("Helvetica", 11)
    canvas.drawString(
        48,
        600,
        "Invented values test the software connection only. "
        "They are not patient data or drug evidence.",
    )
    canvas.drawString(
        48, 580, "Demo review confirmations are automated fixtures. No model provider is contacted."
    )
    for index, span in enumerate(demo_input().spans):
        top = 515 - index * 112
        canvas.setFillColorRGB(0.94, 0.96, 0.98)
        canvas.roundRect(48, top - 74, 984, 90, 7, fill=1, stroke=0)
        canvas.setFillColorRGB(0.13, 0.2, 0.28)
        canvas.setFont("Helvetica-Bold", 12)
        canvas.drawString(66, top - 8, f"Invented observation {index + 1}")
        size = min(10, 948 / stringWidth(span.text, "Helvetica", 10) * 10)
        canvas.setFont("Helvetica", size)
        canvas.drawString(66, top - 43, span.text)
    canvas.setFont("Helvetica", 10)
    canvas.setFillColorRGB(0.3, 0.37, 0.44)
    canvas.drawString(
        48,
        42,
        "Synthetic demo / one page / fixed-size, equal-allocation hypothetical comparisons only",
    )
    canvas.showPage()
    canvas.save()
    target.chmod(0o600)
    print(target.resolve())


if __name__ == "__main__":
    main()
