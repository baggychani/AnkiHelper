from __future__ import annotations

import sys

from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QAction, QColor, QTextCharFormat, QSyntaxHighlighter
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QPlainTextEdit,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

from .anki_package import (
    ApkgReadError,
    DeckPackage,
    NoteType,
    export_bundle,
    export_design,
    export_tsv,
    read_apkg,
    render_template,
)


APP_STYLES = """
* { font-family: 'Segoe UI', 'Malgun Gothic', sans-serif; }
QMainWindow, QWidget#root { background: #F5F6FA; color: #20283A; }
QToolBar { background: #FFFFFF; border: 0; border-bottom: 1px solid #E6E9F0; spacing: 7px; padding: 11px 20px; }
QToolButton { color: #4D5B75; border-radius: 8px; padding: 7px 12px; font-weight: 600; }
QToolButton:hover { background: #F0F2F8; }
QFrame#sidebar, QFrame#panel { background: #FFFFFF; border: 1px solid #E5E8F0; border-radius: 12px; }
QFrame#deviceStage { background: #EDF0F6; border: 1px solid #DFE4EE; border-radius: 12px; }
QFrame#device { background: #FFFFFF; border: 7px solid #202738; border-radius: 28px; }
QFrame#deviceLaptop { background: #FFFFFF; border: 8px solid #202738; border-radius: 14px; }
QLabel#eyebrow { color: #73819B; font-size: 11px; font-weight: 700; letter-spacing: 1px; }
QLabel#title { color: #17213A; font-size: 25px; font-weight: 750; }
QLabel#sectionTitle { color: #17213A; font-size: 15px; font-weight: 700; }
QLabel#muted { color: #77849B; font-size: 12px; }
QLabel#fieldChip {
    background: #F0F2F8; color: #3D4A64; border: 1px solid #E2E6EF;
    border-radius: 8px; padding: 6px 11px; font-size: 12px; font-weight: 650;
}
QPushButton { background: #FFFFFF; color: #3D4A64; border: 1px solid #DAE0EA; border-radius: 9px; padding: 8px 12px; font-weight: 650; }
QPushButton:hover { background: #F4F6FB; border-color: #C9D2E0; }
QPushButton#primary { background: #5B5CE2; color: white; border: 0; }
QPushButton#primary:hover { background: #4B4BCD; }
QPushButton#segment { border-radius: 8px; min-width: 64px; }
QPushButton#segment:checked { background: #ECECFF; color: #4849BE; border-color: #D9D9FF; }
QListWidget { border: 0; background: transparent; outline: none; padding: 4px; }
QListWidget::item { padding: 9px 10px; border-radius: 8px; margin: 2px 0; color: #46536C; }
QListWidget::item:selected { background: #ECECFF; color: #4B4BC5; font-weight: 700; }
QTableWidget { border: 1px solid #E5E8F0; border-radius: 10px; gridline-color: #EDF0F5; background: #FFFFFF; alternate-background-color: #FAFBFD; }
QHeaderView::section { background: #F7F8FC; color: #64728C; border: 0; border-bottom: 1px solid #E5E8F0; padding: 9px; font-size: 11px; font-weight: 700; }
QTableCornerButton::section { background: #F7F8FC; border: 0; border-bottom: 1px solid #E5E8F0; }
QPlainTextEdit { background: #1D2434; color: #E5EBF7; border: 1px solid #303A50; border-radius: 10px; font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; padding: 10px; }
QWebEngineView { background: #FFFFFF; border: 0; }
QScrollArea { background: transparent; border: 0; }
QTabWidget::pane { border: 0; background: transparent; top: -1px; }
QTabBar::tab { background: transparent; color: #748198; padding: 10px 18px; margin-right: 4px; border-bottom: 2px solid transparent; font-weight: 650; }
QTabBar::tab:selected { color: #4B4BC5; border-bottom-color: #5B5CE2; }
QTabBar::tab:hover { color: #4B4BC5; }
QSplitter::handle { background: #E6E9F0; width: 1px; margin: 0 8px; }
"""


class MarkupHighlighter(QSyntaxHighlighter):
    def __init__(self, document) -> None:
        super().__init__(document)
        self.tag = QTextCharFormat(); self.tag.setForeground(QColor("#8DE1C0"))
        self.token = QTextCharFormat(); self.token.setForeground(QColor("#F6C56F"))
        self.comment = QTextCharFormat(); self.comment.setForeground(QColor("#8390AA"))

    def highlightBlock(self, text: str) -> None:
        import re

        for pattern, style in (
            (r"</?[^>]+>", self.tag),
            (r"{{[^}]+}}", self.token),
            (r"/\*.*?\*/", self.comment),
        ):
            for match in re.finditer(pattern, text):
                self.setFormat(match.start(), match.end() - match.start(), style)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.package: DeckPackage | None = None
        self.note_type: NoteType | None = None
        self.template_index = -1
        self.code_mode = "front"
        self.preview_side = "front"
        self.preview_index = 0
        self.device_mode = "phone"
        self.setWindowTitle("Anki Helper")
        self.setMinimumSize(1040, 700)
        self._build_ui()

    def _build_ui(self) -> None:
        toolbar = QToolBar("Main")
        toolbar.setMovable(False)
        self.addToolBar(toolbar)
        brand = QLabel("ANKI HELPER")
        brand.setStyleSheet("font-size: 14px; font-weight: 800; color: #4B4BC5; letter-spacing: 1px; padding-right: 18px;")
        toolbar.addWidget(brand)
        open_action = QAction("APKG 열기", self)
        open_action.triggered.connect(self.open_package)
        toolbar.addAction(open_action)
        toolbar.addSeparator()
        toolbar.addAction("TSV 저장", self.save_tsv)
        toolbar.addAction("디자인 저장", self.save_design)
        toolbar.addAction("번들 내보내기", self.save_bundle)

        root = QWidget(objectName="root")
        self.setCentralWidget(root)
        outer = QHBoxLayout(root)
        outer.setContentsMargins(12, 12, 12, 12)
        outer.setSpacing(0)
        split = QSplitter(Qt.Orientation.Horizontal)
        split.setChildrenCollapsible(False)
        split.setHandleWidth(17)
        outer.addWidget(split)
        split.addWidget(self._create_sidebar())
        split.addWidget(self._create_workspace())
        split.setStretchFactor(0, 0)
        split.setStretchFactor(1, 1)
        split.setSizes([250, 1200])

    def _create_sidebar(self) -> QWidget:
        sidebar = QFrame(objectName="sidebar")
        sidebar.setMinimumWidth(220)
        sidebar.setMaximumWidth(300)
        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(10)
        layout.addWidget(QLabel("SOURCE", objectName="eyebrow"))
        self.file_name = QLabel("아직 열지 않음", objectName="sectionTitle")
        self.file_name.setWordWrap(True)
        layout.addWidget(self.file_name)
        self.file_detail = QLabel("APKG 파일을 열어 시작하세요", objectName="muted")
        self.file_detail.setWordWrap(True)
        layout.addWidget(self.file_detail)
        button = QPushButton("＋ APKG 파일 선택", objectName="primary")
        button.clicked.connect(self.open_package)
        layout.addWidget(button)
        divider = QFrame()
        divider.setFrameShape(QFrame.Shape.HLine)
        divider.setStyleSheet("color: #E7E9F0;")
        layout.addWidget(divider)
        layout.addWidget(QLabel("노트 타입", objectName="eyebrow"))
        self.note_list = QListWidget()
        self.note_list.currentRowChanged.connect(self.select_note_type)
        layout.addWidget(self.note_list, 1)
        self.stats = QLabel("필드 · 카드 · 노트", objectName="muted")
        self.stats.setWordWrap(True)
        layout.addWidget(self.stats)
        return sidebar

    def _create_workspace(self) -> QWidget:
        area = QWidget()
        layout = QVBoxLayout(area)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        heading = QHBoxLayout()
        heading.setContentsMargins(0, 0, 0, 0)
        text = QVBoxLayout()
        text.setSpacing(2)
        text.addWidget(QLabel("APKG INSPECTOR", objectName="eyebrow"))
        self.page_title = QLabel("카드 자료를 준비하세요", objectName="title")
        text.addWidget(self.page_title)
        heading.addLayout(text)
        heading.addStretch()
        self.export_button = QPushButton("↓ 번들 내보내기", objectName="primary")
        self.export_button.clicked.connect(self.save_bundle)
        self.export_button.setEnabled(False)
        heading.addWidget(self.export_button)
        layout.addLayout(heading)
        self.pages = QStackedWidget()
        self.pages.addWidget(self._create_welcome())
        self.pages.addWidget(self._create_workbench())
        layout.addWidget(self.pages, 1)
        return area

    def _create_welcome(self) -> QWidget:
        panel = QFrame(objectName="panel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(48, 48, 48, 48)
        layout.addStretch()
        icon = QLabel("✦")
        icon.setStyleSheet("font-size: 42px; color: #5B5CE2;")
        icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(icon)
        title = QLabel("Anki 덱을 작업 가능한 자료로", objectName="title")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)
        copy = QLabel(
            "APKG의 필드·카드 디자인·전체 데이터를 분리해 확인하고\n"
            "TSV와 디자인 번들을 바로 저장할 수 있습니다.",
            objectName="muted",
        )
        copy.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(copy)
        choose = QPushButton("APKG 파일 열기", objectName="primary")
        choose.setFixedWidth(180)
        choose.clicked.connect(self.open_package)
        row = QHBoxLayout(); row.addStretch(); row.addWidget(choose); row.addStretch()
        layout.addLayout(row)
        layout.addStretch()
        return panel

    def _create_workbench(self) -> QWidget:
        self.workbench = QTabWidget()
        self.workbench.addTab(self._create_data_page(), "데이터")
        self.workbench.addTab(self._create_design_page(), "디자인")
        self.workbench.addTab(self._create_preview_page(), "미리보기")
        return self.workbench

    def _panel_heading(self, title: str, detail: str) -> tuple[QFrame, QVBoxLayout]:
        panel = QFrame(objectName="panel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(8)
        layout.addWidget(QLabel(title, objectName="sectionTitle"))
        hint = QLabel(detail, objectName="muted")
        layout.addWidget(hint)
        return panel, layout

    def _create_data_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(10)

        fields_strip = QFrame(objectName="panel")
        fields_layout = QVBoxLayout(fields_strip)
        fields_layout.setContentsMargins(14, 10, 14, 10)
        fields_layout.setSpacing(8)
        fields_header = QHBoxLayout()
        fields_header.setSpacing(10)
        fields_header.addWidget(QLabel("필드 목록", objectName="sectionTitle"))
        self.fields_hint = QLabel("입력 파일의 열 이름 · 왼쪽 번호가 Anki 필드 순서", objectName="muted")
        fields_header.addWidget(self.fields_hint, 1)
        fields_layout.addLayout(fields_header)

        fields_scroll = QScrollArea()
        fields_scroll.setWidgetResizable(True)
        fields_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        fields_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        fields_scroll.setFixedHeight(42)
        fields_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.fields_row = QWidget()
        self.fields_row_layout = QHBoxLayout(self.fields_row)
        self.fields_row_layout.setContentsMargins(0, 0, 0, 0)
        self.fields_row_layout.setSpacing(8)
        self.fields_row_layout.addStretch()
        fields_scroll.setWidget(self.fields_row)
        fields_layout.addWidget(fields_scroll)
        layout.addWidget(fields_strip)

        data_panel, data_layout = self._panel_heading("전체 데이터", "APKG에 포함된 모든 노트입니다.")
        self.data_hint = QLabel("", objectName="muted")
        data_layout.insertWidget(2, self.data_hint)
        self.data_table = QTableWidget()
        self.data_table.setAlternatingRowColors(True)
        self.data_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.data_table.setWordWrap(False)
        data_layout.addWidget(self.data_table, 1)
        layout.addWidget(data_panel, 1)
        return page

    def _create_design_page(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(10)
        templates, templates_layout = self._panel_heading("카드 템플릿", "편집할 카드를 선택하세요.")
        templates.setMaximumWidth(260)
        self.template_list = QListWidget()
        self.template_list.currentRowChanged.connect(self.select_template)
        templates_layout.addWidget(self.template_list, 1)
        layout.addWidget(templates)
        code_panel, code_layout = self._panel_heading("카드 디자인 코드", "변경사항은 즉시 미리보기에 반영됩니다.")
        mode_row = QHBoxLayout()
        self.front_code_button = self._segment("앞면 HTML", "front")
        self.back_code_button = self._segment("뒷면 HTML", "back")
        self.css_code_button = self._segment("공통 CSS", "css")
        self.front_code_button.setChecked(True)
        mode_row.addWidget(self.front_code_button)
        mode_row.addWidget(self.back_code_button)
        mode_row.addWidget(self.css_code_button)
        mode_row.addStretch()
        self.copy_button = QPushButton("⧉ 복사")
        self.copy_button.clicked.connect(self.copy_code)
        mode_row.addWidget(self.copy_button)
        code_layout.addLayout(mode_row)
        self.code_editor = QPlainTextEdit()
        self.code_editor.textChanged.connect(self.schedule_preview)
        MarkupHighlighter(self.code_editor.document())
        code_layout.addWidget(self.code_editor, 1)
        layout.addWidget(code_panel, 1)
        return page

    def _segment(self, text: str, mode: str) -> QPushButton:
        button = QPushButton(text, objectName="segment")
        button.setCheckable(True)
        button.clicked.connect(lambda: self.set_code_mode(mode))
        return button

    def _create_preview_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(10)
        controls, controls_layout = self._panel_heading("카드 미리보기", "실제 화면에 가까운 비율로 카드 결과를 확인합니다.")
        controls.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum)
        row = QHBoxLayout()
        self.phone_button = self._preview_segment("휴대폰", "phone")
        self.laptop_button = self._preview_segment("노트북", "laptop")
        self.phone_button.setChecked(True)
        row.addWidget(self.phone_button); row.addWidget(self.laptop_button)
        row.addSpacing(20)
        self.preview_front_button = self._side_segment("앞면", "front")
        self.preview_back_button = self._side_segment("뒷면", "back")
        self.preview_front_button.setChecked(True)
        row.addWidget(self.preview_front_button); row.addWidget(self.preview_back_button)
        row.addStretch()
        self.previous_note_button = QPushButton("‹ 이전")
        self.previous_note_button.clicked.connect(lambda: self.move_preview_note(-1))
        self.next_note_button = QPushButton("다음 ›")
        self.next_note_button.clicked.connect(lambda: self.move_preview_note(1))
        row.addWidget(self.previous_note_button); row.addWidget(self.next_note_button)
        controls_layout.addLayout(row)
        layout.addWidget(controls)

        stage_scroll = QScrollArea()
        stage_scroll.setWidgetResizable(True)
        stage_scroll.setFrameShape(QFrame.Shape.NoFrame)
        stage_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        stage_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.device_stage = QFrame(objectName="deviceStage")
        stage_layout = QHBoxLayout(self.device_stage)
        stage_layout.setContentsMargins(24, 24, 24, 24)
        stage_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.device_shell = QFrame(objectName="device")
        self.device_shell.setFixedSize(390, 680)
        device_layout = QVBoxLayout(self.device_shell)
        device_layout.setContentsMargins(10, 16, 10, 12)
        device_layout.setSpacing(8)
        self.device_caption = QLabel("1 / 1 · 앞면", objectName="muted")
        self.device_caption.setAlignment(Qt.AlignmentFlag.AlignCenter)
        device_layout.addWidget(self.device_caption)
        self.preview = QWebEngineView()
        self.preview.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self.preview.page().setBackgroundColor(QColor("#FFFFFF"))
        device_layout.addWidget(self.preview, 1)
        stage_layout.addWidget(self.device_shell)
        stage_scroll.setWidget(self.device_stage)
        layout.addWidget(stage_scroll, 1)
        return page

    def _preview_segment(self, text: str, mode: str) -> QPushButton:
        button = QPushButton(text, objectName="segment")
        button.setCheckable(True)
        button.clicked.connect(lambda: self.set_device_mode(mode))
        return button

    def _side_segment(self, text: str, side: str) -> QPushButton:
        button = QPushButton(text, objectName="segment")
        button.setCheckable(True)
        button.clicked.connect(lambda: self.set_preview_side(side))
        return button

    def open_package(self) -> None:
        filename, _ = QFileDialog.getOpenFileName(self, "Anki APKG 열기", "", "Anki package (*.apkg)")
        if not filename:
            return
        try:
            package = read_apkg(filename)
        except ApkgReadError as exc:
            QMessageBox.critical(self, "열 수 없음", str(exc))
            return
        self.package = package
        self.file_name.setText(package.source.name)
        self.file_detail.setText(f"{len(package.note_types)}개 노트 타입 · {len(package.media)}개 미디어")
        self.note_list.clear()
        for note_type in package.note_types:
            self.note_list.addItem(QListWidgetItem(note_type.name))
        self.pages.setCurrentIndex(1)
        self.export_button.setEnabled(bool(package.note_types))
        if package.note_types:
            self.note_list.setCurrentRow(0)

    def select_note_type(self, row: int) -> None:
        if not self.package or row < 0 or row >= len(self.package.note_types):
            return
        self._stash_code()
        self.note_type = self.package.note_types[row]
        self.template_index = -1
        self.preview_index = 0
        note_type = self.note_type
        self.page_title.setText(note_type.name)
        self.stats.setText(f"{len(note_type.fields)}개 필드 · {len(note_type.templates)}개 카드 · {len(note_type.notes)}개 노트")
        self._populate_data(note_type)
        self.template_list.clear()
        for template in note_type.templates:
            self.template_list.addItem(template.name)
        if note_type.templates:
            self.template_list.setCurrentRow(0)
        else:
            self.code_editor.clear()
            self.preview.setHtml("")

    def _populate_data(self, note_type: NoteType) -> None:
        while self.fields_row_layout.count():
            item = self.fields_row_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
        for index, field in enumerate(note_type.fields, start=1):
            chip = QLabel(f"{index}  {field.name}")
            chip.setObjectName("fieldChip")
            chip.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.fields_row_layout.addWidget(chip)
        self.fields_row_layout.addStretch()
        self.fields_hint.setText(f"{len(note_type.fields)}개 필드 · 왼쪽 번호가 Anki 필드 순서")

        self.data_table.setColumnCount(len(note_type.fields))
        self.data_table.setHorizontalHeaderLabels([field.name for field in note_type.fields])
        self.data_table.setRowCount(len(note_type.notes))
        for row, values in enumerate(note_type.notes):
            for column, value in enumerate(values[:len(note_type.fields)]):
                self.data_table.setItem(row, column, QTableWidgetItem(value))
        self.data_table.resizeColumnsToContents()
        self.data_hint.setText(f"총 {len(note_type.notes):,}개 노트 · 표를 스크롤하여 모두 확인할 수 있습니다.")

    def select_template(self, row: int) -> None:
        if not self.note_type or row < 0 or row >= len(self.note_type.templates):
            return
        self._stash_code()
        self.template_index = row
        self._load_code_editor()
        self.update_preview()

    def set_code_mode(self, mode: str) -> None:
        if mode == self.code_mode:
            return
        self._stash_code()
        self.code_mode = mode
        self.front_code_button.setChecked(mode == "front")
        self.back_code_button.setChecked(mode == "back")
        self.css_code_button.setChecked(mode == "css")
        self._load_code_editor()

    def _load_code_editor(self) -> None:
        text = ""
        if self.note_type and self.note_type.templates and self.template_index >= 0:
            template = self.note_type.templates[self.template_index]
            text = {"front": template.front, "back": template.back, "css": self.note_type.css}[self.code_mode]
        self.code_editor.blockSignals(True)
        self.code_editor.setPlainText(text)
        self.code_editor.blockSignals(False)

    def _stash_code(self) -> None:
        if not self.note_type or self.template_index < 0 or self.template_index >= len(self.note_type.templates):
            return
        content = self.code_editor.toPlainText()
        template = self.note_type.templates[self.template_index]
        if self.code_mode == "front":
            template.front = content
        elif self.code_mode == "back":
            template.back = content
        else:
            self.note_type.css = content

    def copy_code(self) -> None:
        QApplication.clipboard().setText(self.code_editor.toPlainText())
        self.copy_button.setText("✓ 복사됨")
        QTimer.singleShot(1400, lambda: self.copy_button.setText("⧉ 복사"))

    def schedule_preview(self) -> None:
        QTimer.singleShot(160, self.update_preview)

    def set_preview_side(self, side: str) -> None:
        self.preview_side = side
        self.preview_front_button.setChecked(side == "front")
        self.preview_back_button.setChecked(side == "back")
        self.update_preview()

    def set_device_mode(self, mode: str) -> None:
        self.device_mode = mode
        self.phone_button.setChecked(mode == "phone")
        self.laptop_button.setChecked(mode == "laptop")
        is_phone = mode == "phone"
        self.device_shell.setObjectName("device" if is_phone else "deviceLaptop")
        if is_phone:
            self.device_shell.setFixedSize(390, 680)
        else:
            self.device_shell.setFixedSize(860, 540)
        self.device_shell.style().unpolish(self.device_shell)
        self.device_shell.style().polish(self.device_shell)

    def move_preview_note(self, step: int) -> None:
        if not self.note_type or not self.note_type.notes:
            return
        self.preview_index = (self.preview_index + step) % len(self.note_type.notes)
        self.update_preview()

    def update_preview(self) -> None:
        self._stash_code()
        if not self.note_type or not self.note_type.templates:
            return
        if self.template_index < 0 or self.template_index >= len(self.note_type.templates):
            return
        values = self.note_type.notes[self.preview_index] if self.note_type.notes else [""] * len(self.note_type.fields)
        template = self.note_type.templates[self.template_index]
        front = render_template(template.front, self.note_type.fields, values)
        body = front if self.preview_side == "front" else render_template(template.back, self.note_type.fields, values, front)
        css = self.note_type.css or ""
        document = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
html, body {{
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: #ffffff;
  color: #20263A;
  font-family: 'Segoe UI', 'Malgun Gothic', sans-serif;
}}
.card {{
  font-family: 'Segoe UI', 'Malgun Gothic', sans-serif;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
  min-height: 100%;
  box-sizing: border-box;
}}
.sound {{ color: #5B5CE2; font-size: 13px; }}
{css}
</style></head>
<body class="card">{body}</body></html>"""
        self.preview.setHtml(document, QUrl("about:blank"))
        side_name = "앞면" if self.preview_side == "front" else "뒷면"
        count = max(len(self.note_type.notes), 1)
        self.device_caption.setText(f"{self.preview_index + 1} / {count} · {side_name}")

    def _ready_to_export(self) -> NoteType | None:
        if self.note_type is None:
            QMessageBox.information(self, "내보낼 내용 없음", "먼저 APKG 파일과 노트 타입을 선택하세요.")
            return None
        return self.note_type

    def save_tsv(self) -> None:
        note_type = self._ready_to_export()
        if not note_type:
            return
        filename, _ = QFileDialog.getSaveFileName(self, "입력 TSV 저장", f"{note_type.name}_input.tsv", "TSV (*.tsv)")
        if filename:
            export_tsv(note_type, filename)
            self.statusBar().showMessage("입력 TSV를 저장했습니다.", 4000)

    def save_design(self) -> None:
        note_type = self._ready_to_export()
        if not note_type:
            return
        self._stash_code()
        filename, _ = QFileDialog.getSaveFileName(self, "디자인 JSON 저장", f"{note_type.name}_design.json", "JSON (*.json)")
        if filename:
            export_design(note_type, filename)
            self.statusBar().showMessage("디자인 JSON을 저장했습니다.", 4000)

    def save_bundle(self) -> None:
        note_type = self._ready_to_export()
        if not note_type or not self.package:
            return
        self._stash_code()
        filename, _ = QFileDialog.getSaveFileName(
            self, "Anki Helper 번들 내보내기", f"{note_type.name}_anki_helper.zip", "ZIP (*.zip)"
        )
        if filename:
            export_bundle(self.package, note_type, filename)
            self.statusBar().showMessage("입력 데이터와 디자인 번들을 저장했습니다.", 5000)


def main() -> None:
    from PySide6.QtCore import QCoreApplication

    QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    app = QApplication(sys.argv)
    app.setApplicationName("Anki Helper")
    app.setStyleSheet(APP_STYLES)
    window = MainWindow()
    window.showMaximized()
    sys.exit(app.exec())
