from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6.QtCore import QAbstractAnimation, QEasingCurve, QSize, Qt, QTimer, QUrl, QVariantAnimation
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap, QTextCharFormat, QSyntaxHighlighter
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QComboBox,
    QDialog,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QPlainTextEdit,
    QMenu,
    QSizePolicy,
    QStackedWidget,
    QStyle,
    QStyledItemDelegate,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QToolButton,
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
QMainWindow, QWidget#root { background: #F4F5F9; color: #1F2940; }
QFrame#panel { background: #FFFFFF; border: 1px solid #E7E9F1; border-radius: 14px; }
QFrame#nav { background: #FBFBFD; border: 0; border-right: 1px solid #E5E7EF; }
QLabel#navBrand { color: #19213A; font-size: 14px; font-weight: 800; letter-spacing: .6px; }
QLabel#navTagline { color: #9097AA; font-size: 10px; }
QLabel#navEyebrow { color: #A0A6B5; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; }
QLabel#navDetail { color: #747C91; font-size: 11px; }
QLabel#navVersion { color: #8D94A7; font-size: 10px; font-weight: 700; letter-spacing: .8px; }
QLabel#navCopyright { color: #A1A7B6; font-size: 10px; }
QToolButton#collapseButton { background: transparent; border: 0; padding: 0; }
QToolButton#collapseButton:hover { background: #F0F1F6; border-radius: 10px; }
QPushButton#navButton { background: transparent; color: #606A80; border: 0; border-radius: 10px; padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 650; }
QPushButton#navButton:hover { background: #F0F1F6; color: #222A40; }
QPushButton#navButton:checked { background: #EBEBFF; color: #5253D4; }
QPushButton#navButton[collapsed="true"] { padding: 9px 0; text-align: center; }
QPushButton#navButton::menu-indicator { image: none; width: 0; }
QPushButton#navPrimary { background: #5D5FEF; color: #FFFFFF; border: 0; border-radius: 10px; padding: 10px 12px; text-align: left; font-weight: 700; }
QPushButton#navPrimary:hover { background: #5052DA; }
QPushButton#navPrimary[collapsed="true"] { padding: 9px 0; text-align: center; }
QComboBox#deckSelector { background: #FFFFFF; color: #30384D; border: 1px solid #DEE1EA; min-width: 0; }
QComboBox#deckSelector:disabled { color: #A1A7B6; background: #F7F7FA; }
QFrame#deviceStage { background: #EAECF3; border: 1px solid #E0E3EC; border-radius: 14px; }
QFrame#deviceResponsive { background: #FFFFFF; border: 1px solid #D9DEEA; border-radius: 10px; }
QLabel#eyebrow { color: #73819B; font-size: 11px; font-weight: 700; letter-spacing: 1px; }
QLabel#title { color: #17213A; font-size: 23px; font-weight: 750; }
QLabel#sectionTitle { color: #17213A; font-size: 15px; font-weight: 700; }
QLabel#muted { color: #77849B; font-size: 12px; }
QLabel#countBadge { background: #EEF0FF; color: #5051C7; border-radius: 8px; padding: 5px 9px; font-size: 11px; font-weight: 700; }
QPushButton { background: #FFFFFF; color: #3D4A64; border: 1px solid #DEE2EB; border-radius: 9px; padding: 8px 12px; font-weight: 650; }
QPushButton:hover { background: #F7F7FB; border-color: #CBD1DE; }
QPushButton#primary { background: #5B5CE2; color: white; border: 0; }
QPushButton#primary:hover { background: #4B4BCD; }
QPushButton#segment { border-radius: 8px; min-width: 64px; }
QPushButton#segment:checked { background: #ECECFF; color: #4849BE; border-color: #D9D9FF; }
QListWidget { border: 0; background: transparent; outline: none; padding: 4px; }
QListWidget::item { padding: 9px 10px; border-radius: 8px; margin: 2px 0; color: #46536C; }
QListWidget::item:selected { background: #ECECFF; color: #4B4BC5; font-weight: 700; }
QComboBox { background: #FFFFFF; color: #3D4A64; border: 1px solid #DAE0EA; border-radius: 9px; padding: 7px 30px 7px 11px; font-weight: 650; min-width: 180px; }
QComboBox:disabled { color: #A3ACBC; background: #F7F8FB; }
QComboBox::drop-down { border: 0; width: 24px; }
QMenu { background: #FFFFFF; border: 1px solid #DDE2EC; padding: 6px; }
QMenu::item { padding: 8px 28px 8px 12px; border-radius: 6px; }
QMenu::item:selected { background: #F0F2F8; }
QTableWidget { border: 1px solid #E8EAF1; border-radius: 10px; gridline-color: #EFF1F5; background: #FFFFFF; alternate-background-color: #FAFAFC; }
QTableWidget::item:selected { background: transparent; color: #20283A; }
QTableWidget::item:hover { background: transparent; }
QHeaderView::section { background: #F7F8FC; color: #64728C; border: 0; border-bottom: 1px solid #E5E8F0; padding: 9px; font-size: 11px; font-weight: 700; }
QTableCornerButton::section { background: #F7F8FC; border: 0; border-bottom: 1px solid #E5E8F0; }
QPlainTextEdit { background: #1D2434; color: #E5EBF7; border: 1px solid #303A50; border-radius: 10px; font-family: 'Cascadia Code', Consolas, monospace; font-size: 14px; padding: 10px; }
QWebEngineView { background: #FFFFFF; border: 0; }
QTabWidget::pane { border: 0; background: transparent; top: -1px; }
"""


ICON_PATHS = {
    "folder": "M3 7.5h6l2-2h3l2 2h5v11H3z",
    "table": "M3 4.5h18v15H3z M3 9.5h18 M9 9.5v10",
    "design": "M4 20l1-4 10.8-10.8 3 3L8 19z M13.8 7.2l3 3",
    "preview": "M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    "export": "M4 14v6h16v-6 M12 3v12 M8 11l4 4 4-4",
    "chevron-left": "M14.5 6l-6 6 6 6",
    "chevron-right": "M9.5 6l6 6-6 6",
}


def line_icon(name: str, color: str = "#687187", size: int = 20) -> QIcon:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        f'<path d="{ICON_PATHS[name]}" fill="none" stroke="{color}" stroke-width="1.8" '
        f'stroke-linecap="round" stroke-linejoin="round"/></svg>'
    ).encode("utf-8")
    renderer = QSvgRenderer(svg)
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    renderer.render(painter)
    painter.end()
    return QIcon(pixmap)


class CalmItemDelegate(QStyledItemDelegate):
    """Paint table cells without platform hover, focus, or selection effects."""

    def initStyleOption(self, option, index) -> None:
        super().initStyleOption(option, index)
        option.state &= ~QStyle.StateFlag.State_MouseOver
        option.state &= ~QStyle.StateFlag.State_Selected
        option.state &= ~QStyle.StateFlag.State_HasFocus


PREVIEW_DOCUMENT = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style id="anki-custom"></style>
<style>
html, body { margin:0; padding:0; width:100%; height:100%; background:#fff; color:#20263A; }
#anki-card { min-height:100%; box-sizing:border-box; font-family:'Segoe UI','Malgun Gothic',sans-serif; font-size:20px; text-align:center; background:#fff; }
.sound { color:#5B5CE2; font-size:13px; }
</style></head><body><div id="anki-card" class="card"></div></body></html>"""


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
        self.asset_root = Path(__file__).resolve().parents[2] / "assets"
        self.package: DeckPackage | None = None
        self.note_type: NoteType | None = None
        self.template_index = -1
        self.code_mode = "front"
        self.preview_side = "front"
        self.preview_index = 0
        self.sidebar_collapsed = False
        self.loading_package = False
        self.preview_timer = QTimer(self)
        self.preview_timer.setSingleShot(True)
        self.preview_timer.timeout.connect(self.update_preview)
        self.setWindowTitle("Anki Helper")
        self.setWindowIcon(QIcon(str(self.asset_root / "anki-helper-icon.png")))
        self.setMinimumSize(1040, 700)
        self._build_ui()

    def _build_ui(self) -> None:
        root = QWidget(objectName="root")
        self.setCentralWidget(root)
        outer = QHBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        outer.addWidget(self._create_sidebar())
        outer.addWidget(self._create_workspace(), 1)

    def _create_sidebar(self) -> QWidget:
        self.sidebar = QFrame(objectName="nav")
        self.sidebar.setFixedWidth(260)
        layout = QVBoxLayout(self.sidebar)
        layout.setContentsMargins(16, 18, 16, 14)
        layout.setSpacing(6)

        self.expanded_header = QWidget()
        header = QHBoxLayout(self.expanded_header)
        header.setContentsMargins(0, 0, 0, 0)
        header.setSpacing(12)
        logo_label = QLabel()
        logo = QPixmap(str(self.asset_root / "anki-helper-icon.png"))
        logo_label.setPixmap(
            logo.scaled(34, 34, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        )
        logo_label.setFixedSize(34, 34)
        header.addWidget(logo_label)
        brand_text = QVBoxLayout()
        brand_text.setSpacing(1)
        self.nav_brand = QLabel("ANKI HELPER", objectName="navBrand")
        self.nav_tagline = QLabel("Deck workspace", objectName="navTagline")
        brand_text.addWidget(self.nav_brand)
        brand_text.addWidget(self.nav_tagline)
        header.addLayout(brand_text)
        header.addStretch()
        self.collapse_button = QToolButton(objectName="collapseButton")
        self.collapse_button.setIcon(line_icon("chevron-left", "#777F92", 18))
        self.collapse_button.setIconSize(QSize(18, 18))
        self.collapse_button.setFixedSize(24, 34)
        self.collapse_button.clicked.connect(self.toggle_sidebar)
        self.collapse_button.setToolTip("사이드바 접기")
        header.addWidget(self.collapse_button)
        layout.addWidget(self.expanded_header)

        self.collapsed_header = QWidget()
        compact_header = QVBoxLayout(self.collapsed_header)
        compact_header.setContentsMargins(0, 0, 0, 0)
        compact_header.setSpacing(10)
        compact_logo = QLabel()
        compact_logo.setPixmap(
            logo.scaled(30, 30, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        )
        compact_logo.setFixedSize(30, 30)
        compact_logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        compact_header.addWidget(compact_logo, alignment=Qt.AlignmentFlag.AlignHCenter)
        self.expand_button = QToolButton(objectName="collapseButton")
        self.expand_button.setIcon(line_icon("chevron-right", "#777F92", 18))
        self.expand_button.setIconSize(QSize(18, 18))
        self.expand_button.setFixedSize(30, 28)
        self.expand_button.setToolTip("사이드바 펼치기")
        self.expand_button.clicked.connect(self.toggle_sidebar)
        compact_header.addWidget(self.expand_button, alignment=Qt.AlignmentFlag.AlignHCenter)
        self.collapsed_header.hide()
        layout.addWidget(self.collapsed_header)
        layout.addSpacing(22)

        self.deck_label = QLabel("DECK", objectName="navEyebrow")
        layout.addWidget(self.deck_label)
        self.source_detail = QLabel("불러온 덱이 없습니다", objectName="navDetail")
        self.source_detail.setWordWrap(True)
        layout.addWidget(self.source_detail)
        self.note_type_selector = QComboBox(objectName="deckSelector")
        self.note_type_selector.setEnabled(False)
        self.note_type_selector.setVisible(False)
        self.note_type_selector.currentIndexChanged.connect(self.select_note_type)
        layout.addWidget(self.note_type_selector)
        layout.addSpacing(4)

        self.open_button = QPushButton("APKG 열기", objectName="navPrimary")
        self.open_button.setIcon(line_icon("folder", "#FFFFFF"))
        self.open_button.setIconSize(QSize(19, 19))
        self.open_button.setFixedHeight(42)
        self.open_button.setProperty("collapsed", False)
        self.open_button.clicked.connect(self.open_package)
        layout.addWidget(self.open_button)
        self.deck_divider = QFrame()
        self.deck_divider.setFrameShape(QFrame.Shape.HLine)
        self.deck_divider.setStyleSheet("color: #E9EBF1;")
        layout.addSpacing(16)
        layout.addWidget(self.deck_divider)
        layout.addSpacing(16)
        self.workspace_label = QLabel("WORKSPACE", objectName="navEyebrow")
        layout.addWidget(self.workspace_label)
        layout.addSpacing(4)

        self.nav_buttons: list[tuple[QPushButton, str, str]] = []
        for icon_name, label, index in (("table", "전체 데이터", 0), ("design", "카드 디자인", 1), ("preview", "미리보기", 2)):
            button = QPushButton(label, objectName="navButton")
            button.setIcon(line_icon(icon_name))
            button.setIconSize(QSize(19, 19))
            button.setFixedHeight(42)
            button.setProperty("collapsed", False)
            button.setCheckable(True)
            button.setEnabled(False)
            button.clicked.connect(lambda _checked=False, page=index: self.navigate_to(page))
            button.setToolTip(label)
            self.nav_buttons.append((button, icon_name, label))
            layout.addWidget(button)
        layout.addStretch()
        self.export_divider = QFrame()
        self.export_divider.setFrameShape(QFrame.Shape.HLine)
        self.export_divider.setStyleSheet("color: #E9EBF1;")
        layout.addWidget(self.export_divider)
        layout.addSpacing(12)
        self.export_label = QLabel("EXPORT", objectName="navEyebrow")
        layout.addWidget(self.export_label)
        layout.addSpacing(4)
        self.export_button = QPushButton("내보내기", objectName="navButton")
        self.export_button.setIcon(line_icon("export"))
        self.export_button.setIconSize(QSize(19, 19))
        self.export_button.setFixedHeight(42)
        self.export_button.setProperty("collapsed", False)
        self.export_button.setEnabled(False)
        export_menu = QMenu(self.export_button)
        export_menu.addAction("입력 TSV 저장", self.save_tsv)
        export_menu.addAction("디자인 JSON 저장", self.save_design)
        export_menu.addSeparator()
        export_menu.addAction("번들 내보내기", self.save_bundle)
        self.export_button.setMenu(export_menu)
        layout.addWidget(self.export_button)
        self.notice = QLabel("", objectName="navDetail")
        self.notice.setWordWrap(True)
        layout.addWidget(self.notice)
        self.version_label = QLabel("VERSION 1.3.1", objectName="navVersion")
        self.copyright_label = QLabel("© 2026 Bae Gichan", objectName="navCopyright")
        layout.addWidget(self.version_label)
        layout.addWidget(self.copyright_label)

        self.sidebar_animation = QVariantAnimation(self)
        self.sidebar_animation.setDuration(240)
        self.sidebar_animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        self.sidebar_animation.valueChanged.connect(lambda value: self.sidebar.setFixedWidth(int(value)))
        self.sidebar_animation.finished.connect(self._finish_sidebar_animation)
        return self.sidebar

    def toggle_sidebar(self) -> None:
        if self.sidebar_animation.state() == QAbstractAnimation.State.Running:
            return
        self.sidebar_collapsed = not self.sidebar_collapsed
        self._set_sidebar_compact(True)
        self.sidebar_animation.setStartValue(self.sidebar.width())
        self.sidebar_animation.setEndValue(84 if self.sidebar_collapsed else 260)
        self.sidebar_animation.start()

    def _set_sidebar_compact(self, compact: bool) -> None:
        self.expanded_header.setVisible(not compact)
        self.collapsed_header.setVisible(compact)
        for widget in (
            self.deck_label,
            self.source_detail,
            self.note_type_selector,
            self.deck_divider,
            self.workspace_label,
            self.export_divider,
            self.export_label,
            self.notice,
            self.version_label,
            self.copyright_label,
        ):
            widget.setVisible(
                not compact
                and (
                    widget is not self.note_type_selector
                    or bool(self.package and self.package.note_types)
                )
            )
        self.open_button.setText("" if compact else "APKG 열기")
        self.open_button.setProperty("collapsed", compact)
        for button, _icon_name, label in self.nav_buttons:
            button.setText("" if compact else label)
            button.setProperty("collapsed", compact)
            button.style().unpolish(button)
            button.style().polish(button)
        self.export_button.setText("" if compact else "내보내기")
        self.export_button.setProperty("collapsed", compact)
        for button in (self.open_button, self.export_button):
            button.style().unpolish(button)
            button.style().polish(button)

    def _finish_sidebar_animation(self) -> None:
        if not self.sidebar_collapsed:
            self._set_sidebar_compact(False)

    def navigate_to(self, index: int) -> None:
        if self.package is None:
            return
        self.pages.setCurrentIndex(1)
        self.workbench.setCurrentIndex(index)
        for button_index, (button, icon_name, _label) in enumerate(self.nav_buttons):
            active = button_index == index
            button.setChecked(active)
            button.setIcon(line_icon(icon_name, "#5657D8" if active else "#687187"))

    def _create_workspace(self) -> QWidget:
        area = QWidget()
        layout = QVBoxLayout(area)
        layout.setContentsMargins(16, 10, 16, 10)
        layout.setSpacing(7)

        heading = QHBoxLayout()
        heading.setContentsMargins(2, 0, 2, 0)
        self.page_title = QLabel("카드 자료를 준비하세요", objectName="title")
        heading.addWidget(self.page_title)
        heading.addStretch()
        self.page_eyebrow = QLabel("APKG INSPECTOR", objectName="eyebrow")
        heading.addWidget(self.page_eyebrow)
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
        layout.setSpacing(0)
        layout.addStretch()
        icon = QLabel()
        logo = QPixmap(str(self.asset_root / "anki-helper-icon.png"))
        icon.setPixmap(
            logo.scaled(84, 84, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        )
        icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(icon)
        layout.addSpacing(26)
        title = QLabel("Anki 덱을 작업 가능한 자료로", objectName="title")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)
        layout.addSpacing(12)
        copy = QLabel(
            "APKG의 필드·카드 디자인·전체 데이터를 분리해 확인하고\n"
            "TSV와 디자인 번들을 바로 저장할 수 있습니다.",
            objectName="muted",
        )
        copy.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(copy)
        layout.addSpacing(24)
        choose = QPushButton("APKG 파일 열기", objectName="primary")
        choose.setFixedSize(190, 44)
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
        self.workbench.tabBar().hide()
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
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        data_panel = QFrame(objectName="panel")
        data_layout = QVBoxLayout(data_panel)
        data_layout.setContentsMargins(14, 10, 14, 14)
        data_layout.setSpacing(8)
        data_header = QHBoxLayout()
        data_header.addWidget(QLabel("전체 데이터", objectName="sectionTitle"))
        data_header.addStretch()
        self.data_count = QLabel("0개 노트", objectName="countBadge")
        data_header.addWidget(self.data_count)
        data_layout.addLayout(data_header)
        self.data_table = QTableWidget()
        self.data_table.setAlternatingRowColors(True)
        self.data_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.data_table.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self.data_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.data_table.setMouseTracking(False)
        self.data_table.viewport().setAttribute(Qt.WidgetAttribute.WA_Hover, False)
        self.data_table.setItemDelegate(CalmItemDelegate(self.data_table))
        self.data_table.setWordWrap(False)
        self.data_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
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
        layout = QHBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        self.device_stage = QFrame(objectName="deviceStage")
        stage_layout = QHBoxLayout(self.device_stage)
        stage_layout.setContentsMargins(14, 14, 14, 14)
        self.device_shell = QFrame(objectName="deviceResponsive")
        self.device_shell.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        device_layout = QVBoxLayout(self.device_shell)
        device_layout.setContentsMargins(0, 0, 0, 0)
        device_layout.setSpacing(0)
        self.device_caption = QLabel("1 / 1 · 앞면", objectName="muted")
        self.device_caption.setStyleSheet("padding: 10px 12px; border-bottom: 1px solid #ECEEF3;")
        self.device_caption.setAlignment(Qt.AlignmentFlag.AlignCenter)
        device_layout.addWidget(self.device_caption)
        self.preview = QWebEngineView()
        self.preview.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self.preview.page().setBackgroundColor(QColor("#FFFFFF"))
        self.preview_ready = False
        self.preview.loadFinished.connect(self._preview_loaded)
        self.preview.setHtml(PREVIEW_DOCUMENT, QUrl("about:blank"))
        device_layout.addWidget(self.preview, 1)
        stage_layout.addWidget(self.device_shell)
        layout.addWidget(self.device_stage, 1)

        controls = QFrame(objectName="panel")
        controls.setFixedWidth(176)
        controls_layout = QVBoxLayout(controls)
        controls_layout.setContentsMargins(14, 14, 14, 14)
        controls_layout.setSpacing(8)
        controls_layout.addWidget(QLabel("미리보기", objectName="sectionTitle"))
        controls_layout.addSpacing(12)
        controls_layout.addWidget(QLabel("CARD SIDE", objectName="eyebrow"))
        self.preview_front_button = self._side_segment("앞면", "front")
        self.preview_back_button = self._side_segment("뒷면", "back")
        self.preview_front_button.setChecked(True)
        controls_layout.addWidget(self.preview_front_button)
        controls_layout.addWidget(self.preview_back_button)
        controls_layout.addStretch()
        self.previous_note_button = QPushButton("‹ 이전 노트")
        self.previous_note_button.clicked.connect(lambda: self.move_preview_note(-1))
        self.next_note_button = QPushButton("다음 노트 ›")
        self.next_note_button.clicked.connect(lambda: self.move_preview_note(1))
        controls_layout.addWidget(self.previous_note_button)
        controls_layout.addWidget(self.next_note_button)
        layout.addWidget(controls)
        return page

    def _side_segment(self, text: str, side: str) -> QPushButton:
        button = QPushButton(text, objectName="segment")
        button.setCheckable(True)
        button.clicked.connect(lambda: self.set_preview_side(side))
        return button

    def open_package(self) -> None:
        if self.loading_package:
            return
        dialog = QFileDialog(self, "Anki APKG 열기")
        dialog.setNameFilter("Anki package (*.apkg)")
        dialog.setFileMode(QFileDialog.FileMode.ExistingFile)
        dialog.setOption(QFileDialog.Option.DontUseNativeDialog, True)
        dialog.setWindowModality(Qt.WindowModality.WindowModal)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        selected = dialog.selectedFiles()
        if not selected:
            return
        filename = selected[0]
        self.loading_package = True
        self.open_button.setEnabled(False)
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        try:
            package = read_apkg(filename)
        except ApkgReadError as exc:
            QMessageBox.critical(self, "열 수 없음", str(exc))
            return
        finally:
            QApplication.restoreOverrideCursor()
            self.open_button.setEnabled(True)
            self.loading_package = False
        self.package = package
        self.source_detail.setText(
            f"{package.source.name} · {len(package.note_types)}개 노트 타입 · {len(package.media)}개 미디어"
        )
        self.note_type_selector.blockSignals(True)
        self.note_type_selector.clear()
        for note_type in package.note_types:
            self.note_type_selector.addItem(note_type.name)
        self.note_type_selector.blockSignals(False)
        self.note_type_selector.setEnabled(bool(package.note_types))
        self.note_type_selector.setVisible(bool(package.note_types) and not self.sidebar_collapsed)
        self.pages.setCurrentIndex(1)
        self.export_button.setEnabled(bool(package.note_types))
        for button, _icon, _label in self.nav_buttons:
            button.setEnabled(bool(package.note_types))
        if package.note_types:
            self.note_type_selector.setCurrentIndex(0)
            self.select_note_type(0)
            self.navigate_to(0)

    def select_note_type(self, row: int) -> None:
        if not self.package or row < 0 or row >= len(self.package.note_types):
            return
        self._stash_code()
        self.note_type = self.package.note_types[row]
        self.template_index = -1
        self.preview_index = 0
        note_type = self.note_type
        self.page_title.setText(note_type.name)
        self.page_eyebrow.setText(
            f"{len(note_type.fields)}개 필드 · {len(note_type.templates)}개 카드"
        )
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
        self.data_table.setColumnCount(len(note_type.fields))
        self.data_table.setHorizontalHeaderLabels([field.name for field in note_type.fields])
        self.data_table.setRowCount(len(note_type.notes))
        for row, values in enumerate(note_type.notes):
            for column, value in enumerate(values[:len(note_type.fields)]):
                self.data_table.setItem(row, column, QTableWidgetItem(value))
        self.data_count.setText(f"{len(note_type.notes):,}개 노트")
        QTimer.singleShot(0, self._fit_data_columns)

    def _fit_data_columns(self) -> None:
        if not self.note_type or self.data_table.columnCount() == 0:
            return
        available = max(self.data_table.viewport().width() - 2, 600)
        metrics = self.data_table.fontMetrics()
        natural_widths: list[int] = []
        sample_step = max(1, len(self.note_type.notes) // 160)
        sampled_notes = self.note_type.notes[::sample_step][:160]
        for column, field in enumerate(self.note_type.fields):
            longest = metrics.horizontalAdvance(field.name) + 32
            for values in sampled_notes:
                value = values[column] if column < len(values) else ""
                longest = max(longest, metrics.horizontalAdvance(value[:72]) + 28)
            natural_widths.append(max(100, min(longest, 420)))

        minimum = 90
        total = sum(natural_widths)
        if total < available:
            extra = available - total
            weight_total = max(total, 1)
            widths = [width + round(extra * width / weight_total) for width in natural_widths]
        elif available >= minimum * len(natural_widths):
            flexible_total = sum(width - minimum for width in natural_widths)
            flexible_budget = available - minimum * len(natural_widths)
            widths = [
                minimum + round(flexible_budget * (width - minimum) / max(flexible_total, 1))
                for width in natural_widths
            ]
        else:
            widths = natural_widths

        if sum(widths) <= available:
            widths[-1] += available - sum(widths)
        for column, width in enumerate(widths):
            self.data_table.setColumnWidth(column, width)

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
        self.preview_timer.start(90)

    def _preview_loaded(self, ok: bool) -> None:
        self.preview_ready = ok
        if ok:
            self.update_preview()

    def set_preview_side(self, side: str) -> None:
        self.preview_side = side
        self.preview_front_button.setChecked(side == "front")
        self.preview_back_button.setChecked(side == "back")
        self.update_preview()

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
        if not self.preview_ready:
            self._update_device_caption()
            return
        payload = json.dumps({"body": body, "css": css}, ensure_ascii=False)
        self.preview.page().runJavaScript(
            f"""(() => {{
                const data = {payload};
                const card = document.getElementById('anki-card');
                const style = document.getElementById('anki-custom');
                if (!card || !style) return;
                style.textContent = data.css;
                card.innerHTML = data.body;
            }})()"""
        )
        self._update_device_caption()

    def _update_device_caption(self) -> None:
        side_name = "앞면" if self.preview_side == "front" else "뒷면"
        count = max(len(self.note_type.notes), 1) if self.note_type else 1
        self.device_caption.setText(f"{self.preview_index + 1} / {count} · {side_name}")

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if hasattr(self, "data_table") and self.note_type is not None:
            QTimer.singleShot(0, self._fit_data_columns)

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
            self._show_notice("입력 TSV를 저장했습니다.")

    def save_design(self) -> None:
        note_type = self._ready_to_export()
        if not note_type:
            return
        self._stash_code()
        filename, _ = QFileDialog.getSaveFileName(self, "디자인 JSON 저장", f"{note_type.name}_design.json", "JSON (*.json)")
        if filename:
            export_design(note_type, filename)
            self._show_notice("디자인 JSON을 저장했습니다.")

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
            self._show_notice("입력 데이터와 디자인 번들을 저장했습니다.")

    def _show_notice(self, message: str) -> None:
        self.notice.setText(message)
        QTimer.singleShot(5000, lambda: self.notice.setText(""))


def main() -> None:
    from PySide6.QtCore import QCoreApplication

    QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    app = QApplication(sys.argv)
    app.setApplicationName("Anki Helper")
    app.setStyleSheet(APP_STYLES)
    window = MainWindow()
    window.showMaximized()
    sys.exit(app.exec())
