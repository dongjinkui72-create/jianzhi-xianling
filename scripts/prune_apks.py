#!/usr/bin/env python3
"""发布产物清理：每次新版打包后，只保留最新 3 个 APK。

默认目录：D:\董金奎\Documents\ai
可用环境变量 JZ_APK_DIR 指定其它目录。
"""
import os
import pathlib

root = pathlib.Path(os.environ.get("JZ_APK_DIR", r"D:\董金奎\Documents\ai")).resolve()
keep = int(os.environ.get("JZ_APK_KEEP", "3"))
files = sorted(root.glob("剪纸仙灵-v*.apk"), key=lambda p: p.stat().st_mtime, reverse=True)
for p in files[keep:]:
    full = p.resolve()
    if root not in full.parents:
        raise SystemExit(f"拒绝删除目录外文件: {full}")
    full.unlink()
    print("DELETED", full.name)
print("KEPT")
for p in sorted(root.glob("剪纸仙灵-v*.apk"), key=lambda p: p.stat().st_mtime, reverse=True):
    print(" ", p.name)
