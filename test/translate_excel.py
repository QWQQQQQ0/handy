"""
翻译 Excel "选项集" 工作表 B 列内容到 C 列
复用 python-engine 的 COM 连接逻辑，确保和 doc_code_exec 执行环境一致。

用法：先打开目标 Excel 文件，再运行此脚本
"""

import sys
import os

# 把 python-engine 加入 path，复用 com_resolver 的连接逻辑
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python-engine'))

from engine.office.com_resolver import get_app, clear_cache, _ensure_com


def main():
    _ensure_com()

    # 连接 Excel（和 doc_code_exec 里的 get_excel_app() 同样的逻辑）
    try:
        app = get_app("excel", connect_only=True)
    except Exception as e:
        print(f"[错误] 无法连接 Excel: {e}")
        sys.exit(1)

    print(f"[信息] 已连接 Excel，Workbooks.Count={app.Workbooks.Count}")

    wb = app.ActiveWorkbook
    print(f"[信息] 活跃工作簿: {wb.Name} ({wb.FullName})")

    # 获取"选项集"工作表
    try:
        ws = wb.Worksheets("选项集")
    except Exception:
        sheets = [wb.Worksheets(i + 1).Name for i in range(wb.Worksheets.Count)]
        print(f"[错误] 找不到'选项集'工作表，现有: {sheets}")
        sys.exit(1)

    print(f"[信息] 工作表: {ws.Name}, 行数: {ws.UsedRange.Rows.Count}")

    # 读取 B 列数据
    total_rows = ws.UsedRange.Rows.Count
    b_values = []
    for row in range(1, total_rows + 1):
        val = ws.Cells(row, 2).Value
        b_values.append(val)

    print(f"\n--- B 列数据 ({total_rows} 行) ---")
    for i, v in enumerate(b_values, 1):
        print(f"  行{i}: {v!r}")

    # 这里应该由 LLM 翻译，而不是硬编码映射
    # 模拟 LLM 翻译结果（实际场景中 LLM 会调用 com_edit 写回）
    print("\n[提示] 实际使用中，LLM 会根据上面的数据自行翻译，然后调用 com_edit 写回 C 列")
    print("[提示] 例如: com_edit({app: 'excel', operation: 'write', range: 'C1:C50', values: [[...]]})")

    result = {
        "status": "done",
        "sheet": ws.Name,
        "total_rows": total_rows,
        "b_column_values": b_values,
    }
    print(f"\nresult = {result}")


if __name__ == "__main__":
    main()
