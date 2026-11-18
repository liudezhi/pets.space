"""Bundle the Vite build and Node service for local acceptance. Run after npm run build."""
import argparse
import os
from pathlib import Path
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
FOLDER = "栖光谷/"
INSTRUCTIONS = """栖光谷 · 本机验收版

安装 Node.js 24 LTS（最低 22.13），将整个压缩包解压。
Windows 可双击 start.cmd，macOS 可双击 start.command。
也可以在本目录打开终端，执行 node server/start.mjs。
看到“栖光谷已启动”后，保留终端，在浏览器打开 http://127.0.0.1:4173。
按 Ctrl+C 停止。再次启动可继续上次的探访。

点“进入 3D 漫游”沿步道散步。浏览、看照片、给公开花园送雏菊都免费。
体验建园时，从终端标明的 sandbox-invite.txt 文件中读取邀请码。
本地默认模拟结算。请保管界面发给你的园主恢复码。
操作见 docs/验收手册.md，数据迁移见 docs/运行与百年保存.md。
包内同时附有源代码。要继续开发，请依 README.md 运行 npm ci。
数据位于压缩包解压目录之外。换电脑继续使用原档案，需要同时迁移数据。
"""
WINDOWS = """@echo off
cd /d "%~dp0"
node server/start.mjs
if errorlevel 1 pause
"""
MAC = """#!/bin/sh
cd "$(dirname "$0")" || exit 1
exec node server/start.mjs
"""


def write_text(archive, name, body, mode=0o644):
    entry = ZipInfo(FOLDER + name)
    entry.create_system = 3
    entry.external_attr = (0o100000 | mode) << 16
    archive.writestr(entry, body.encode("utf-8"), compress_type=ZIP_DEFLATED)


def bundle(output):
    if not (ROOT / "dist/index.html").is_file():
        raise SystemExit("请先在仓库根目录运行 npm ci 和 npm run build。")
    # Only distribute source/media formats in known project directories. User data lives outside the checkout.
    files = [p for p in (ROOT / "dist").rglob("*") if p.is_file()]
    suffixes = {".mjs", ".js", ".css", ".html", ".py", ".md", ".svg", ".webp", ".json"}
    for directory in ["server", "shared", "src", "public", "docs", "tests", "scripts"]:
        files.extend(p for p in (ROOT / directory).rglob("*") if p.is_file() and p.suffix in suffixes)
    files.extend(ROOT / name for name in [
        "package.json", "package-lock.json", "index.html", "vite.config.js", "README.md",
        "design-qa.md", "栖光谷产品与景观设计.md", ".gitignore",
    ])
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as temp:
        stage = Path(temp.name)
    try:
        with ZipFile(stage, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(files):
                archive.write(path, FOLDER + path.relative_to(ROOT).as_posix())
            for package in ["three", "bootstrap-icons"]:
                archive.write(ROOT / "node_modules" / package / "LICENSE", FOLDER + "licenses/" + package + ".txt")
            write_text(archive, "从这里开始.txt", INSTRUCTIONS)
            write_text(archive, "start.cmd", WINDOWS.replace("\n", "\r\n"))
            write_text(archive, "start.command", MAC, 0o755)
        os.replace(stage, output)
    finally:
        stage.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="验收包的 .zip 文件路径（应位于项目外）")
    archive_path = parser.parse_args().output.resolve()
    if archive_path.suffix.lower() != ".zip" or archive_path.is_relative_to(ROOT):
        parser.error("请指定项目目录之外的 .zip 文件。")
    bundle(archive_path)
    print(archive_path)
