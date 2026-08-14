#!/usr/bin/env python3
"""Build the evaluator-facing Fluent Me Tavus take-home report.

The report is intentionally evidence-bounded. It summarizes what the source
materials say is implemented, and separately labels every item that still
needs a live run or reviewer-access verification.

Run from the repository root:
    python submission/build_report.py
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
SUBMISSION = ROOT / "submission"
MEDIA = SUBMISSION / "media"
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "fluent-me-tavus-take-home-report.pdf"

PAGE_W, PAGE_H = LETTER
MARGIN_X = 44
MARGIN_TOP = 58
MARGIN_BOTTOM = 46
CONTENT_W = PAGE_W - (2 * MARGIN_X)
CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM

INK = HexColor("#10131A")
INK_2 = HexColor("#293140")
MUTED = HexColor("#657083")
QUIET = HexColor("#8B94A3")
PAPER = HexColor("#F5F3EE")
WHITE = HexColor("#F8F8F7")
DARK = HexColor("#090B10")
PANEL = HexColor("#11151C")
LINE = HexColor("#D8D8D6")
VIOLET = HexColor("#7055EF")
VIOLET_BRIGHT = HexColor("#8B79FF")
VIOLET_SOFT = HexColor("#EAE6FF")
MINT = HexColor("#28B88F")
MINT_SOFT = HexColor("#DCF5ED")
CYAN = HexColor("#A9DCDF")
AMBER = HexColor("#DB9632")
AMBER_SOFT = HexColor("#F9EBD5")


def para(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            tracking=1.8,
            textColor=VIOLET_BRIGHT,
            spaceAfter=15,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName="Times-Roman",
            fontSize=39,
            leading=41,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=15,
        ),
        "cover_dek": ParagraphStyle(
            "cover_dek",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=13,
            leading=20,
            textColor=HexColor("#C7CDDA"),
            spaceAfter=0,
        ),
        "cover_quote": ParagraphStyle(
            "cover_quote",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11.5,
            leading=18,
            textColor=HexColor("#E6E8EF"),
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=HexColor("#98A2B5"),
            tracking=1.2,
        ),
        "kicker": ParagraphStyle(
            "kicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            tracking=1.5,
            textColor=VIOLET,
            spaceAfter=7,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Times-Roman",
            fontSize=25,
            leading=28,
            textColor=INK,
            spaceAfter=9,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=INK,
            spaceBefore=0,
            spaceAfter=5,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=12,
            textColor=INK,
            spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14.2,
            textColor=INK_2,
            spaceAfter=7,
        ),
        "body_tight": ParagraphStyle(
            "body_tight",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12.2,
            textColor=INK_2,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=10.5,
            textColor=MUTED,
        ),
        "caption": ParagraphStyle(
            "caption",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.3,
            leading=10,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "card_title": ParagraphStyle(
            "card_title",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12.5,
            textColor=INK,
            spaceAfter=4,
        ),
        "card_body": ParagraphStyle(
            "card_body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=11.5,
            textColor=INK_2,
        ),
        "inverse_title": ParagraphStyle(
            "inverse_title",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=13,
            textColor=WHITE,
            spaceAfter=4,
        ),
        "inverse_body": ParagraphStyle(
            "inverse_body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=11.5,
            textColor=HexColor("#C7CDDA"),
        ),
        "list": ParagraphStyle(
            "list",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.6,
            leading=12.3,
            textColor=INK_2,
            leftIndent=12,
            firstLineIndent=-8,
            bulletIndent=0,
            spaceAfter=4,
        ),
    }


class RoundedScreenshot(Flowable):
    def __init__(self, path: Path, width: float, height: float | None = None, radius: float = 11):
        super().__init__()
        self.path = Path(path)
        with PILImage.open(self.path) as image:
            image_w, image_h = image.size
        self.width = width
        self.height = height or width * image_h / image_w
        self.radius = radius
        self.reader = ImageReader(str(self.path))

    def wrap(self, avail_width, avail_height):
        return min(self.width, avail_width), self.height

    def draw(self):
        canvas = self.canv
        canvas.saveState()
        path = canvas.beginPath()
        path.roundRect(0, 0, self.width, self.height, self.radius)
        canvas.clipPath(path, stroke=0, fill=0)
        canvas.drawImage(
            self.reader,
            0,
            0,
            width=self.width,
            height=self.height,
            preserveAspectRatio=True,
            anchor="c",
            mask="auto",
        )
        canvas.restoreState()
        canvas.setStrokeColor(HexColor("#C8C9CD"))
        canvas.setLineWidth(0.7)
        canvas.roundRect(0, 0, self.width, self.height, self.radius, stroke=1, fill=0)


class ProductLoop(Flowable):
    def __init__(self, steps: Sequence[tuple[str, str]], width: float = CONTENT_W, height: float = 78):
        super().__init__()
        self.steps = steps
        self.width = width
        self.height = height

    def wrap(self, avail_width, avail_height):
        self.width = min(self.width, avail_width)
        return self.width, self.height

    def draw(self):
        canvas = self.canv
        count = len(self.steps)
        gap = 7
        box_w = (self.width - gap * (count - 1)) / count
        for index, (title, detail) in enumerate(self.steps):
            x = index * (box_w + gap)
            canvas.setFillColor(WHITE)
            canvas.setStrokeColor(HexColor("#D7D6DA"))
            canvas.roundRect(x, 8, box_w, self.height - 8, 8, stroke=1, fill=1)
            canvas.setFillColor(VIOLET if index < 4 else MINT)
            canvas.roundRect(x + 9, self.height - 24, 17, 13, 6.5, stroke=0, fill=1)
            canvas.setFillColor(colors.white)
            canvas.setFont("Helvetica-Bold", 6.5)
            canvas.drawCentredString(x + 17.5, self.height - 20, str(index + 1))
            canvas.setFillColor(INK)
            canvas.setFont("Helvetica-Bold", 8.2)
            canvas.drawString(x + 9, self.height - 38, title)
            canvas.setFillColor(MUTED)
            canvas.setFont("Helvetica", 6.7)
            canvas.drawString(x + 9, 17, detail)
            if index < count - 1:
                canvas.setStrokeColor(HexColor("#AAA5C8"))
                canvas.setLineWidth(0.7)
                canvas.line(x + box_w + 1.5, self.height / 2, x + box_w + gap - 1.5, self.height / 2)


class ArchitectureDiagram(Flowable):
    def __init__(self, styles: dict[str, ParagraphStyle], width: float = CONTENT_W, height: float = 240):
        super().__init__()
        self.styles = styles
        self.width = width
        self.height = height

    def wrap(self, avail_width, avail_height):
        self.width = min(self.width, avail_width)
        return self.width, self.height

    def _box(self, x, y, w, h, title, body, fill, stroke):
        canvas = self.canv
        canvas.setFillColor(fill)
        canvas.setStrokeColor(stroke)
        canvas.setLineWidth(0.8)
        canvas.roundRect(x, y, w, h, 9, stroke=1, fill=1)
        p_title = Paragraph(title, self.styles["card_title"])
        p_body = Paragraph(body, self.styles["card_body"])
        tw, th = p_title.wrap(w - 18, h - 14)
        bw, bh = p_body.wrap(w - 18, h - th - 18)
        p_title.drawOn(canvas, x + 9, y + h - th - 8)
        p_body.drawOn(canvas, x + 9, y + 9)

    def _arrow(self, x1, y1, x2, y2, color=VIOLET):
        canvas = self.canv
        canvas.setStrokeColor(color)
        canvas.setFillColor(color)
        canvas.setLineWidth(1.2)
        canvas.line(x1, y1, x2, y2)
        direction = 1 if x2 >= x1 else -1
        canvas.line(x2, y2, x2 - (5 * direction), y2 + 3)
        canvas.line(x2, y2, x2 - (5 * direction), y2 - 3)

    def draw(self):
        w = self.width
        browser_w = 151
        server_w = 112
        tavus_w = 188
        gap = (w - browser_w - server_w - tavus_w) / 2
        y = 72
        h = 127
        x_browser = 0
        x_server = browser_w + gap
        x_tavus = x_server + server_w + gap

        self._box(
            x_browser,
            y,
            browser_w,
            h,
            "Browser",
            "Video-first UI<br/>Daily client<br/>Event correlation<br/>Transient signal analysis<br/>Current-tab review<br/>Opt-in local memory",
            WHITE,
            HexColor("#CFCED4"),
        )
        self._box(
            x_server,
            y + 18,
            server_w,
            h - 36,
            "Server boundary",
            "Sites Worker or FastAPI<br/><br/>Create/end rooms<br/>Keep provider keys server-side",
            VIOLET_SOFT,
            HexColor("#B9B0F5"),
        )
        self._box(
            x_tavus,
            y,
            tavus_w,
            h,
            "Tavus CVI",
            "Private Daily room<br/>PAL behavior<br/>STT + LLM + TTS<br/>Phoenix Face<br/>Raven perception<br/>Sparrow turn-taking",
            MINT_SOFT,
            HexColor("#9FD8C7"),
        )
        self._arrow(x_browser + browser_w + 4, y + 76, x_server - 5, y + 76)
        self._arrow(x_server - 5, y + 60, x_browser + browser_w + 4, y + 60, MINT)
        self._arrow(x_server + server_w + 4, y + 76, x_tavus - 5, y + 76)
        self._arrow(x_tavus - 5, y + 60, x_server + server_w + 4, y + 60, MINT)

        canvas = self.canv
        optional_w = 278
        optional_x = (w - optional_w) / 2
        canvas.setFillColor(HexColor("#F0EFF3"))
        canvas.setStrokeColor(HexColor("#D5D2DC"))
        canvas.roundRect(optional_x, 4, optional_w, 43, 8, stroke=1, fill=1)
        title = Paragraph("Optional identity providers", self.styles["h3"])
        body = Paragraph("ElevenLabs voice cloning/remixing and Tavus or PAL Maker Face training - used only after explicit consent and provider verification.", self.styles["small"])
        _, title_h = title.wrap(optional_w - 18, 18)
        _, body_h = body.wrap(optional_w - 18, 25)
        title.drawOn(canvas, optional_x + 9, 31)
        body.drawOn(canvas, optional_x + 9, 8)
        canvas.setStrokeColor(QUIET)
        canvas.setDash(3, 3)
        canvas.line(optional_x + optional_w / 2, 47, optional_x + optional_w / 2, 69)
        canvas.setDash()


class LifecycleTimeline(Flowable):
    def __init__(self, steps: Sequence[tuple[str, str]], width: float = CONTENT_W, height: float = 92):
        super().__init__()
        self.steps = steps
        self.width = width
        self.height = height

    def wrap(self, avail_width, avail_height):
        self.width = min(self.width, avail_width)
        return self.width, self.height

    def draw(self):
        canvas = self.canv
        count = len(self.steps)
        pad = 18
        usable = self.width - (2 * pad)
        y_line = self.height - 25
        canvas.setStrokeColor(HexColor("#BFC3CB"))
        canvas.setLineWidth(1)
        canvas.line(pad, y_line, self.width - pad, y_line)
        for index, (title, detail) in enumerate(self.steps):
            x = pad + (usable * index / (count - 1))
            canvas.setFillColor(MINT if index == count - 1 else VIOLET)
            canvas.circle(x, y_line, 6, stroke=0, fill=1)
            canvas.setFillColor(INK)
            canvas.setFont("Helvetica-Bold", 7.8)
            title_w = stringWidth(title, "Helvetica-Bold", 7.8)
            canvas.drawString(max(0, min(self.width - title_w, x - title_w / 2)), y_line - 19, title)
            canvas.setFillColor(MUTED)
            canvas.setFont("Helvetica", 6.5)
            detail_w = stringWidth(detail, "Helvetica", 6.5)
            canvas.drawString(max(0, min(self.width - detail_w, x - detail_w / 2)), y_line - 32, detail)


def card(title: str, body: str, styles: dict[str, ParagraphStyle], fill=WHITE, stroke=LINE, padding=11):
    content = [para(title, styles["card_title"]), para(body, styles["card_body"])]
    table = Table([[content]], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.7, stroke),
                ("LEFTPADDING", (0, 0), (-1, -1), padding),
                ("RIGHTPADDING", (0, 0), (-1, -1), padding),
                ("TOPPADDING", (0, 0), (-1, -1), padding),
                ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def two_column_cards(left, right, width=CONTENT_W, gap=10):
    col = (width - gap) / 2
    table = Table([[left, "", right]], colWidths=[col, gap, col], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return table


def three_column_cards(items: Sequence, width=CONTENT_W, gap=8):
    col = (width - 2 * gap) / 3
    table = Table([[items[0], "", items[1], "", items[2]]], colWidths=[col, gap, col, gap, col], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return table


def bullets(items: Iterable[str], styles: dict[str, ParagraphStyle]):
    return [para(f"- {item}", styles["list"]) for item in items]


def section_header(number: str, title: str, dek: str, styles: dict[str, ParagraphStyle]):
    return [
        para(number, styles["kicker"]),
        para(title, styles["h1"]),
        para(dek, styles["body"]),
        Spacer(1, 7),
    ]


def page_background(canvas, doc):
    canvas.saveState()
    canvas.setTitle("Fluent Me - Tavus Take-Home Report")
    canvas.setAuthor("Fluent Me")
    canvas.setSubject("Product and technical case study for a conversation-first English coach")
    if doc.page == 1:
        canvas.setFillColor(DARK)
        canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        canvas.setFillColor(CYAN)
        canvas.rect(0, PAGE_H - 4, PAGE_W, 4, stroke=0, fill=1)
        canvas.setFillColor(HexColor("#101522"))
        canvas.roundRect(PAGE_W - 222, 54, 198, 118, 22, stroke=0, fill=1)
        signal_heights = [22, 42, 30, 70, 48, 92, 58, 76, 36, 62, 26, 46]
        for index, height in enumerate(signal_heights):
            canvas.setFillColor(VIOLET_BRIGHT if index % 3 else MINT)
            canvas.roundRect(
                PAGE_W - 205 + (index * 14),
                113 - (height / 2),
                5,
                height,
                2.5,
                stroke=0,
                fill=1,
            )
        canvas.setStrokeColor(HexColor("#253044"))
        canvas.setLineWidth(0.7)
        canvas.line(PAGE_W - 210, 113, PAGE_W - 38, 113)
        canvas.setFillColor(HexColor("#9A8CFF"))
        canvas.rect(MARGIN_X, 38, 22, 3, stroke=0, fill=1)
        canvas.setFillColor(HexColor("#43DCB0"))
        canvas.rect(MARGIN_X + 27, 38, 11, 3, stroke=0, fill=1)
    else:
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        canvas.setFillColor(CYAN)
        canvas.rect(0, PAGE_H - 4, PAGE_W, 4, stroke=0, fill=1)
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.drawString(MARGIN_X, PAGE_H - 30, "FLUENT ME")
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 30, "TAVUS TAKE-HOME")
        canvas.setStrokeColor(HexColor("#D5D5D3"))
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, 34, PAGE_W - MARGIN_X, 34)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(MARGIN_X, 21, "Product and technical case study")
        canvas.drawRightString(PAGE_W - MARGIN_X, 21, f"{doc.page:02d}")
    canvas.restoreState()


def screenshot_gallery(paths: Sequence[Path], styles: dict[str, ParagraphStyle]):
    story = []
    story.extend(section_header("SUPPLEMENT", "Product surfaces", "Additional screenshots are included only when corresponding files exist in submission/media.", styles))
    rows = []
    cells = []
    cell_w = (CONTENT_W - 10) / 2
    for path in paths[:4]:
        image = RoundedScreenshot(path, cell_w, height=cell_w * 0.57, radius=8)
        title = path.stem.replace("_", " ").replace("-", " ").title()
        cells.append([image, Spacer(1, 5), para(title, styles["caption"])])
        if len(cells) == 2:
            rows.append(cells)
            cells = []
    if cells:
        cells.append("")
        rows.append(cells)
    gallery = Table(rows, colWidths=[cell_w, cell_w], hAlign="LEFT")
    gallery.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 14)]))
    story.append(gallery)
    story.append(Spacer(1, 10))
    story.append(card("Evidence note", "A screenshot demonstrates interface state only. A live recording is still required to prove microphone publication, Tavus Face playback, model response, and remote-room cleanup.", styles, fill=AMBER_SOFT, stroke=HexColor("#E4C28F")))
    return story


def build_story(styles: dict[str, ParagraphStyle]):
    story = []

    # Cover
    story.extend(
        [
            Spacer(1, 30),
            para("FLUENT ME / TAVUS TAKE-HOME", styles["cover_kicker"]),
            para("Talk naturally.<br/>Leave with better English.", styles["cover_title"]),
            para("A conversation-first English coach powered by Tavus CVI.", styles["cover_dek"]),
            Spacer(1, 31),
        ]
    )
    quote = Table(
        [[para("Fluent Me closes the gap between knowing a phrase and retrieving it in a real conversation. The learner talks face to face, asks for help when useful, rehearses one exact phrase, and leaves with one grounded next step.", styles["cover_quote"])]],
        colWidths=[CONTENT_W],
    )
    quote.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), HexColor("#141821")), ("BOX", (0, 0), (-1, -1), 0.8, HexColor("#303646")), ("LINEBEFORE", (0, 0), (0, -1), 3, VIOLET_BRIGHT), ("LEFTPADDING", (0, 0), (-1, -1), 17), ("RIGHTPADDING", (0, 0), (-1, -1), 17), ("TOPPADDING", (0, 0), (-1, -1), 15), ("BOTTOMPADDING", (0, 0), (-1, -1), 15)]))
    story.append(quote)
    story.append(Spacer(1, 29))

    pillar_data = []
    for title, detail in [
        ("VIDEO-FIRST", "A person to address, listen to, and imitate."),
        ("EVIDENCE-BOUNDED", "Available signals stay separate from interpretation."),
        ("LEARNER-CONTROLLED", "Feedback, camera, history, and memory remain optional."),
    ]:
        pillar_data.append([para(title, styles["inverse_title"]), para(detail, styles["inverse_body"])])
    pillars = Table([pillar_data], colWidths=[CONTENT_W / 3] * 3)
    pillars.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PANEL), ("BOX", (0, 0), (-1, -1), 0.7, HexColor("#2D3340")), ("INNERGRID", (0, 0), (-1, -1), 0.5, HexColor("#2D3340")), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 13), ("BOTTOMPADDING", (0, 0), (-1, -1), 13), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(pillars)
    story.append(Spacer(1, 70))
    story.append(para("PRODUCT + INTEGRATION CASE STUDY / AUGUST 2026", styles["cover_meta"]))
    story.append(PageBreak())

    # Product thesis
    story.extend(section_header("01 / PRODUCT THESIS", "The face is part of the learning loop.", "A text model can rewrite a sentence. Speaking practice also requires turn-taking, retrieval pressure, modelling, and continuity. Fluent Me uses the live video coach as the primary interaction surface and keeps analysis secondary until the learner asks for it.", styles))
    entry = MEDIA / "entry.png"
    if entry.exists():
        story.append(RoundedScreenshot(entry, CONTENT_W, radius=10))
        story.append(Spacer(1, 5))
        story.append(para("Simplified entry surface: one product promise and one action. Topic, duration, and local-save choices are optional rather than prerequisites.", styles["caption"]))
        story.append(Spacer(1, 13))
    story.append(ProductLoop([
        ("Talk", "real topic"),
        ("Notice", "one useful turn"),
        ("Practice", "one exact phrase"),
        ("Review", "grounded next step"),
        ("Return", "local recall"),
    ]))
    story.append(Spacer(1, 12))
    story.append(two_column_cards(
        card("Design decision", "The first prototype was a rigid lesson sequence. The redesign keeps one continuous conversation, with Feedback, Practice, and Review as callable tools instead of locked stages.", styles, fill=VIOLET_SOFT, stroke=HexColor("#C6BDF8")),
        card("Product boundary", "Camera is off by default. Detailed analysis is hidden behind a drawer or disclosure so a first-time learner can speak before learning the interface.", styles, fill=MINT_SOFT, stroke=HexColor("#A5DCCA")),
    ))
    story.append(PageBreak())

    optional = [
        MEDIA / name
        for name in ("setup.png", "coach-live.png", "feedback.png", "recap.png")
        if (MEDIA / name).exists()
    ]
    if optional:
        story.extend(screenshot_gallery(optional, styles))
        story.append(PageBreak())

    # Tavus and architecture
    story.extend(section_header("02 / WHY TAVUS", "Tavus is structural, not decorative.", "The product works because a real-time video conversation, turn timing, bounded perception, coach behavior, and interaction events operate together. The browser supplies the learning experience; the server protects credentials and owns room lifecycle.", styles))
    capabilities = [
        card("Phoenix Face", "Gives the learner a person to address and a spoken model to imitate.", styles),
        card("Sparrow", "Supports responsive turn-taking and interruption inside a natural exchange.", styles),
        card("Raven", "May add tentative audio or visual context. Missing evidence stays missing.", styles),
    ]
    story.append(three_column_cards(capabilities))
    story.append(Spacer(1, 9))
    story.append(two_column_cards(
        card("PAL", "Defines coach behavior, evidence boundaries, and concise teaching actions.", styles),
        card("Interaction protocol", "Utterance events synchronize the UI; focused respond and exact echo requests support coaching tools.", styles),
    ))
    story.append(Spacer(1, 13))
    story.append(ArchitectureDiagram(styles))
    story.append(Spacer(1, 6))
    story.append(para("Trust boundary: the browser receives a private room URL and short-lived meeting token. Provider API keys remain server-side. Optional identity providers are separate from the core conversation flow.", styles["small"]))
    story.append(PageBreak())

    # Evidence integrity
    story.extend(section_header("03 / EVIDENCE INTEGRITY", "Useful feedback without a mystery score.", "Fluent Me keeps measured evidence, model perception, and teaching guidance separate. It does not collapse every available signal into an English level or confidence number.", styles))
    evidence_cards = [
        card("1. Measured or counted", "Turn timing, transcript words, filled-pause matches, adjacent repeats, and transient browser-signal summaries.", styles, fill=WHITE),
        card("2. Model perception", "Raven observations only when returned, labelled qualitative and tentative rather than ground truth.", styles, fill=VIOLET_SOFT, stroke=HexColor("#C7BFFA")),
        card("3. Teaching guidance", "A recast, stress model, or next practice step that helps rehearsal but is not presented as measurement.", styles, fill=MINT_SOFT, stroke=HexColor("#A5DCCA")),
    ]
    story.append(three_column_cards(evidence_cards))
    story.append(Spacer(1, 13))

    supported = [
        "Actual learner transcript from Tavus conversation events",
        "Duration and WPM when timing and enough words are available",
        "Transcript counts for filled pauses and adjacent repeats",
        "Within-turn waveform, estimated pauses, level movement, and pitch candidates when browser signal is available",
        "Latest-12-turn Language Review with explicit coverage",
    ]
    not_claimed = [
        "No pronunciation, accent, fluency, or emotion score",
        "No phoneme or syllable accuracy without a specialist provider",
        "No claim that waveform height compares across turns",
        "No inference of inner emotion, personality, intelligence, or ability",
        "No percentage-improved or population comparison",
    ]
    left = [para("SUPPORTED OUTPUT", styles["kicker"]), *bullets(supported, styles)]
    right = [para("EXPLICITLY NOT CLAIMED", ParagraphStyle("red_kicker", parent=styles["kicker"], textColor=AMBER)), *bullets(not_claimed, styles)]
    matrix = Table([[left, right]], colWidths=[(CONTENT_W - 10) / 2] * 2)
    matrix.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), WHITE), ("BACKGROUND", (1, 0), (1, 0), AMBER_SOFT), ("BOX", (0, 0), (0, 0), 0.7, LINE), ("BOX", (1, 0), (1, 0), 0.7, HexColor("#E3BF86")), ("LEFTPADDING", (0, 0), (-1, -1), 13), ("RIGHTPADDING", (0, 0), (-1, -1), 13), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(matrix)
    story.append(Spacer(1, 12))
    story.append(card("Bounded language review", "Grammar, word choice, natural expression, and a fact-preserving polished version use at most the latest 12 non-empty learner turns. Names, numbers, links, and meaning must be preserved; the full learner transcript remains a current-tab artifact.", styles, fill=VIOLET_SOFT, stroke=HexColor("#C7BFFA")))
    story.append(PageBreak())

    # Lifecycle and privacy
    story.extend(section_header("04 / LIFECYCLE + PRIVACY", "Design the room lifecycle, not only the happy path.", "Real-time AI has operational states that a form demo can ignore. The timer starts only after remote coach readiness, and manual end, timed end, connection failure, and page exit converge on remote cleanup attempts.", styles))
    story.append(LifecycleTimeline([
        ("Start", "explicit action"),
        ("Ready", "remote media"),
        ("Talk", "live Tavus room"),
        ("Review", "bounded artifacts"),
        ("End", "explicit cleanup"),
    ]))
    story.append(Spacer(1, 5))
    story.append(three_column_cards([
        card("Current tab", "Full transcript view, waveform, pitch contour, attempt evidence, recap, and Language Review.", styles, fill=WHITE),
        card("Optional on device", "At most 20 compact finalized recaps and learner-approved phrases with scheduling metadata.", styles, fill=MINT_SOFT, stroke=HexColor("#A5DCCA")),
        card("Never in local history", "Raw audio/video, full transcript, waveform, pitch contour, Raven observations, or provider credentials.", styles, fill=AMBER_SOFT, stroke=HexColor("#E3BF86")),
    ]))
    story.append(Spacer(1, 13))
    memory_rows = [
        [para("Learning History", styles["h3"]), para("Opt-in before the session; max 20 compact finalized entries; individual delete and clear-all controls.", styles["body_tight"])],
        [para("Learning Memory", styles["h3"]), para("Only an explicitly saved phrase plus fixed review metadata. Reveal or rehearsal does not advance recall.", styles["body_tight"])],
        [para("Review rhythm", styles["h3"]), para("A visible 1/3/7/21/60-day product rule. Not a measured personal forgetting curve; Not quite returns in 10 minutes.", styles["body_tight"])],
    ]
    memory_table = Table(memory_rows, colWidths=[115, CONTENT_W - 115])
    memory_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 11), ("RIGHTPADDING", (0, 0), (-1, -1), 11), ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(memory_table)
    story.append(Spacer(1, 12))
    story.append(card("Optional identity is a separate consent path", "Voice cloning and Face training require explicit ownership/authorization, local review before submission, provider entitlement, and asynchronous verification. The stock coach remains the fallback. A clone or Face is not described as complete merely because the setup UI exists.", styles, fill=VIOLET_SOFT, stroke=HexColor("#C7BFFA")))
    story.append(PageBreak())

    # Delivery truth
    story.extend(section_header("05 / DELIVERY TRUTH", "What the code supports - and what still needs proof.", "This report does not substitute interface state, mocked provider responses, or automated contracts for a continuous live evaluator run against the exact submitted build.", styles))
    implemented = [
        "Conversation create/join/end paths in hosted Worker and FastAPI implementations",
        "Video-first conversation with on-demand Feedback and Practice surfaces",
        "Timed sessions, bounded recap, and latest-turn Language Review contracts",
        "Transient signal visualization and transcript-derived evidence",
        "Opt-in compact History, learner-approved Memory, and fixed review schedule",
        "Consent-gated optional personalization integration paths",
    ]
    proof = [
        "Signed-out reviewer access to the exact deployment",
        "Live microphone reaching Tavus and a relevant spoken response",
        "Moving and audible Tavus Face in the final continuous recording",
        "Raven availability for the exact demonstrated turn, if claimed",
        "ElevenLabs entitlement and a real accepted voice-clone/remix request",
        "Completed Face training and personal PAL playback, if demonstrated",
    ]
    status_table = Table(
        [[
            [para("IMPLEMENTED IN THE PRODUCT", styles["kicker"]), *bullets(implemented, styles)],
            [para("REQUIRES DIRECT VERIFICATION", ParagraphStyle("amber_kicker", parent=styles["kicker"], textColor=AMBER)), *bullets(proof, styles)],
        ]],
        colWidths=[(CONTENT_W - 10) / 2] * 2,
    )
    status_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), MINT_SOFT), ("BACKGROUND", (1, 0), (1, 0), AMBER_SOFT), ("BOX", (0, 0), (0, 0), 0.7, HexColor("#A5DCCA")), ("BOX", (1, 0), (1, 0), 0.7, HexColor("#E3BF86")), ("LEFTPADDING", (0, 0), (-1, -1), 13), ("RIGHTPADDING", (0, 0), (-1, -1), 13), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(status_table)
    story.append(Spacer(1, 13))
    story.append(para("REVIEWER WALKTHROUGH", styles["kicker"]))
    story.append(ProductLoop([
        ("Start", "real room"),
        ("Speak", "learner turn"),
        ("Feedback", "actual evidence"),
        ("Practice", "real attempt"),
        ("Review", "grounded recap"),
    ], height=72))
    story.append(Spacer(1, 12))
    story.append(two_column_cards(
        card("Next product work", "Maintain controlled reviewer access and spend controls; instrument latency without retaining learner media or full transcript history; validate specialist pronunciation scoring before adding it.", styles),
        card("Assessment boundary", "Before adding phoneme, syllable, stress, or prosody scores, evaluate a specialist pronunciation provider and validate the learner benefit.", styles),
    ))
    story.append(Spacer(1, 12))
    story.append(para("Source materials: submission/README.md, submission/ARCHITECTURE.md, submission/DEMO_SCRIPT.md, and submission/DELIVERY_CHECKLIST.md. Public links and the exact code revision are supplied in the submission handoff.", styles["small"]))

    return story


def build_report(output_path: Path) -> Path:
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    frame = Frame(MARGIN_X, MARGIN_BOTTOM, CONTENT_W, CONTENT_H, id="main", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    template = PageTemplate(id="report", frames=[frame], onPage=page_background)
    document = BaseDocTemplate(
        str(output_path),
        pagesize=LETTER,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="Fluent Me - Tavus Take-Home Report",
        author="Fluent Me",
        subject="Conversation-first English coach product and technical case study",
    )
    document.addPageTemplates([template])
    document.build(build_story(styles))
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Final PDF path")
    args = parser.parse_args()
    generated = build_report(args.output)
    print(generated)


if __name__ == "__main__":
    main()
