"""PromptSave Windows native messaging host. No network or automatic logging."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile

BASE = Path(__file__).resolve().parent
HOST_NAME = "com.promptshelf.local"
CHUNK_BYTES = 256 * 1024
INLINE_BYTES = 600 * 1024
MAX_REQUEST = 48 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
IMAGE_PATH = re.compile(r"images/[A-Za-z0-9_-]{1,96}\.jpg\Z")


class HostError(Exception):
    def __init__(self, code, message, name="Error"):
        super().__init__(message)
        self.code = code
        self.name = name


def atomic_write(path, content):
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".promptsave-", dir=path.parent)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            os.unlink(temporary)


def validate_caller():
    manifest = json.loads((BASE / "com.promptshelf.local.json").read_text(encoding="utf-8"))
    origin = sys.argv[1].rstrip("/") + "/" if len(sys.argv) > 1 else ""
    if not re.fullmatch(r"chrome-extension://[a-p]{32}/", origin):
        raise HostError("NATIVE_CALLER_DENIED", "本地桥接调用来源无效")
    if manifest.get("name") != HOST_NAME or origin not in manifest.get("allowed_origins", []):
        raise HostError("NATIVE_CALLER_DENIED", "此扩展 ID 未注册，请重新运行安装脚本")
    return origin


def grant_folder(origin):
    # The only operation accepting a filesystem path gets it from the OS picker.
    import tkinter
    from tkinter import filedialog
    window = tkinter.Tk()
    window.withdraw()
    window.attributes("-topmost", True)
    try:
        selected = filedialog.askdirectory(
            parent=window, title="选择 PromptSave 数据储存文件夹", mustexist=True)
    finally:
        window.destroy()
    if not selected:
        return None
    root = Path(selected).resolve(strict=True)
    if not root.is_dir():
        raise HostError("DIRECTORY_UNAVAILABLE", "所选目录不可用")
    root_id = hashlib.sha256((origin + os.path.normcase(str(root))).encode("utf-8")).hexdigest()
    grants = BASE / "grants"
    grants.mkdir(exist_ok=True)
    record = json.dumps({"origin": origin, "path": str(root)}, ensure_ascii=False).encode("utf-8")
    atomic_write(grants / (root_id + ".json"), record)
    return {"rootId": root_id, "name": root.name or str(root)}


def granted_root(origin, root_id):
    if not isinstance(root_id, str) or not re.fullmatch(r"[a-f0-9]{64}", root_id):
        raise HostError("DIRECTORY_UNAVAILABLE", "目录标识无效，请重新连接本地目录")
    try:
        record = json.loads((BASE / "grants" / (root_id + ".json")).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        raise HostError("DIRECTORY_UNAVAILABLE", "本地目录连接不存在，请重新连接") from None
    root = Path(record["path"])
    if record.get("origin") != origin:
        raise HostError("NATIVE_CALLER_DENIED", "该目录未向此扩展授权")
    if not root.is_dir() or root.is_symlink() or is_reparse(root):
        raise HostError("DIRECTORY_UNAVAILABLE", "储存目录已移动、删除或不可访问")
    if os.path.normcase(str(root.resolve())) != os.path.normcase(str(root)):
        raise HostError("DIRECTORY_UNAVAILABLE", "储存目录路径已改变，请重新连接")
    return root


def is_reparse(path):
    # Also rejects Windows junctions, which is_symlink alone does not detect.
    return bool(path.lstat().st_file_attributes & 0x400) if path.exists() else path.is_symlink()


def managed_path(root, relative):
    if relative not in ("data.json", "recovery.json", "images") and (
            not isinstance(relative, str) or not IMAGE_PATH.fullmatch(relative)):
        raise HostError("NATIVE_PATH_DENIED", "仅允许访问 PromptSave 数据文件")
    if relative.startswith("images/") and re.fullmatch(
            r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", Path(relative).stem, re.IGNORECASE):
        raise HostError("NATIVE_PATH_DENIED", "图片文件名不能使用 Windows 设备名称")
    target = root.joinpath(*relative.split("/"))
    for path in (target.parent, target):
        if path != root and (path.is_symlink() or is_reparse(path)):
            raise HostError("NATIVE_PATH_DENIED", "数据文件不能使用符号链接或目录联接")
    if os.path.commonpath([str(root), str(target.resolve())]) != str(root):
        raise HostError("NATIVE_PATH_DENIED", "文件路径超出已连接目录")
    return target


def file_info(path):
    if not path.is_file():
        if path.exists():
            raise HostError("DIRECTORY_UNAVAILABLE", "数据路径不是普通文件")
        raise HostError("DIRECTORY_NOT_FOUND", "数据文件不存在", "NotFoundError")
    stat = path.stat()
    if stat.st_size > MAX_FILE:
        raise HostError("NATIVE_FILE_TOO_LARGE", "数据文件超过本地桥接的 32 MiB 限制")
    return {"size": stat.st_size, "version": f"{stat.st_mtime_ns}:{stat.st_size}:{stat.st_ino}"}


def dispatch(origin, request):
    if not isinstance(request, dict):
        raise HostError("NATIVE_REQUEST_INVALID", "请求格式无效")
    action = request.get("action")
    if action == "pick":
        return grant_folder(origin)
    root = granted_root(origin, request.get("rootId"))
    if action == "probe":
        if not os.access(root, os.R_OK | os.W_OK):
            raise HostError("DIRECTORY_UNAVAILABLE", "本地目录没有读写权限")
        return {"available": True}
    if action == "open":
        # Only Explorer with the user-picked root, never a shell or caller-supplied command.
        import ctypes
        buffer = ctypes.create_unicode_buffer(32768)
        if not ctypes.windll.kernel32.GetWindowsDirectoryW(buffer, len(buffer)):
            raise HostError("DIRECTORY_UNAVAILABLE", "无法定位 Windows 资源管理器")
        explorer = str(Path(buffer.value) / "explorer.exe")
        subprocess.Popen([explorer, str(root)], shell=False,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, close_fds=True)
        return {"opened": True}
    if action == "images":
        path = managed_path(root, "images")
        if request.get("create") is True:
            path.mkdir(exist_ok=True)
        if not path.is_dir():
            if path.exists():
                raise HostError("DIRECTORY_UNAVAILABLE", "images 路径不是目录")
            raise HostError("DIRECTORY_NOT_FOUND", "图片目录不存在", "NotFoundError")
        return {"exists": True}
    relative = request.get("path")
    path = managed_path(root, relative)
    if relative == "images":
        raise HostError("NATIVE_PATH_DENIED", "该操作只允许普通文件")
    if action == "file":
        # create=true grants a handle without touching disk until write/close.
        if path.exists() or request.get("create") is not True:
            file_info(path)
        return {"exists": path.exists()}
    if action == "stat":
        return file_info(path)
    if action == "readFile":
        info = file_info(path)
        limit = 12 * 1024 * 1024 if relative.startswith("images/") else 8 * 1024 * 1024
        if info["size"] > limit:
            raise HostError("NATIVE_FILE_TOO_LARGE", "文件超过本次读取资源上限，请分批处理或重新收藏压缩图")
        # New previews fit in a single reply below Chrome's 1 MiB message limit.
        if info["size"] <= INLINE_BYTES:
            content = path.read_bytes()
            if file_info(path)["version"] != info["version"]:
                raise HostError("EXTERNAL_CHANGE", "读取过程中文件已改变，请刷新后重试")
            info["base64"] = base64.b64encode(content).decode("ascii")
        return info
    if action == "read":
        before = file_info(path)
        offset = request.get("offset")
        if type(offset) is not int or offset < 0 or offset > before["size"]:
            raise HostError("NATIVE_REQUEST_INVALID", "文件读取偏移无效")
        if request.get("version") != before["version"]:
            raise HostError("EXTERNAL_CHANGE", "读取过程中文件已改变，请刷新后重试")
        with path.open("rb") as stream:
            stream.seek(offset)
            content = stream.read(CHUNK_BYTES)
        if file_info(path)["version"] != before["version"]:
            raise HostError("EXTERNAL_CHANGE", "读取过程中文件已改变，请刷新后重试")
        return {"base64": base64.b64encode(content).decode("ascii")}
    if action == "write":
        if path.exists():
            file_info(path)
        encoded = request.get("base64")
        limit = 12 * 1024 * 1024 if relative.startswith("images/") else 8 * 1024 * 1024
        if not isinstance(encoded, str) or len(encoded) > (limit + 2) // 3 * 4:
            raise HostError("NATIVE_FILE_TOO_LARGE", "写入文件超过本次资源上限")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, base64.binascii.Error):
            raise HostError("NATIVE_REQUEST_INVALID", "文件编码无效") from None
        if len(content) > limit:
            raise HostError("NATIVE_FILE_TOO_LARGE", "写入文件超过本次资源上限")
        if relative.startswith("images/"):
            managed_path(root, "images").mkdir(exist_ok=True)
        atomic_write(path, content)
        return {"written": len(content)}
    if action == "delete":
        if not IMAGE_PATH.fullmatch(relative):
            raise HostError("NATIVE_PATH_DENIED", "仅允许删除托管 JPG 文件")
        file_info(path)
        path.unlink()
        return {"deleted": True}
    raise HostError("NATIVE_REQUEST_INVALID", "未知本地桥接操作")


def read_exact(stream, count):
    parts = bytearray()
    while len(parts) < count:
        part = stream.read(count - len(parts))
        if not part:
            raise HostError("NATIVE_REQUEST_INVALID", "本地消息不完整")
        parts.extend(part)
    return bytes(parts)


def main():
    if os.name != "nt":
        return
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    origin = validate_caller()
    while True:
        header = sys.stdin.buffer.read(4)
        if not header:
            return  # Browser closes stdin after background idle disconnect.
        request_id = None
        try:
            if len(header) != 4:
                header += read_exact(sys.stdin.buffer, 4 - len(header))
            size = struct.unpack("<I", header)[0]
            if not 0 < size <= MAX_REQUEST:
                return  # Do not keep an unframed/oversized connection alive.
            request = json.loads(read_exact(sys.stdin.buffer, size).decode("utf-8"))
            request_id = request.get("requestId") if isinstance(request, dict) else None
            response = {"ok": True, "data": dispatch(origin, request)}
        except HostError as error:
            response = {"ok": False, "error": {
                "code": error.code, "message": str(error), "name": error.name}}
        except Exception:
            response = {"ok": False, "error": {"code": "DIRECTORY_UNAVAILABLE",
                        "message": "本地目录操作失败，请检查目录、权限和桥接安装", "name": "Error"}}
        response["requestId"] = request_id
        encoded = json.dumps(response, ensure_ascii=False).encode("utf-8")
        if len(encoded) >= 1024 * 1024:
            return
        sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        # Do not retain the last image/metadata payload while waiting for more work.
        request = None
        response = None
        encoded = None


if __name__ == "__main__":
    main()
