"""Office document generators and COM automation - Word, Excel, PPT."""

from .word_doc import WordGenerator
from .excel_doc import ExcelGenerator
from .ppt_doc import PptGenerator

# COM modules are optional (require pywin32 + running Office app)
try:
    from .com_word import WordCOM
    from .com_excel import ExcelCOM
    from .com_ppt import PptCOM
except ImportError:
    WordCOM = None  # type: ignore[assignment,misc]
    ExcelCOM = None  # type: ignore[assignment,misc]
    PptCOM = None  # type: ignore[assignment,misc]

__all__ = [
    "WordGenerator", "ExcelGenerator", "PptGenerator",
    "WordCOM", "ExcelCOM", "PptCOM",
]
