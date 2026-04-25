import os
import secrets
import zipfile
import shutil
from datetime import datetime

from flask import (
    Flask, render_template, request, jsonify,
    send_file, send_from_directory, abort,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=secrets.token_hex(16),
    SQLALCHEMY_DATABASE_URI=f"sqlite:///{os.path.join(BASE_DIR, 'data.db')}",
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MAX_CONTENT_LENGTH=200 * 1024 * 1024,  # 200 MB
)

db = SQLAlchemy(app)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Module(db.Model):
    __tablename__ = "modules"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    prototypes = db.relationship(
        "Prototype", backref="module", lazy=True, cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.strftime("%Y/%m/%d %H:%M"),
            "prototype_count": len(self.prototypes),
        }


class Prototype(db.Model):
    __tablename__ = "prototypes"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    preview_id = db.Column(
        db.String(16), unique=True, nullable=False,
        default=lambda: secrets.token_urlsafe(8),
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)
    records = db.relationship(
        "UploadRecord", backref="prototype", lazy=True,
        cascade="all, delete-orphan",
        order_by="UploadRecord.upload_time.desc()",
    )

    @property
    def latest(self):
        return self.records[0] if self.records else None

    def to_dict(self, detail=False):
        latest = self.latest
        d = {
            "id": self.id,
            "name": self.name,
            "description": self.description or "",
            "module_id": self.module_id,
            "module_name": self.module.name,
            "preview_id": self.preview_id,
            "created_at": self.created_at.strftime("%Y/%m/%d %H:%M"),
            "updated_at": self.updated_at.strftime("%Y/%m/%d %H:%M"),
            "has_file": latest is not None,
        }
        if detail:
            d["records"] = [r.to_dict() for r in self.records]
            if latest:
                d["file_type"] = latest.file_type
                d["file_name"] = latest.file_name
        return d


class UploadRecord(db.Model):
    __tablename__ = "upload_records"

    id = db.Column(db.Integer, primary_key=True)
    prototype_id = db.Column(db.Integer, db.ForeignKey("prototypes.id"), nullable=False)
    file_name = db.Column(db.String(255))
    file_path = db.Column(db.String(500))
    file_size = db.Column(db.Integer, default=0)
    file_type = db.Column(db.String(10))   # "html" or "zip"
    preview_dir = db.Column(db.String(500))
    upload_time = db.Column(db.DateTime, default=datetime.utcnow)
    uploader = db.Column(db.String(100), default="")
    update_notes = db.Column(db.Text, default="")

    def to_dict(self):
        return {
            "id": self.id,
            "file_name": self.file_name,
            "file_size": self.file_size,
            "file_type": self.file_type,
            "upload_time": self.upload_time.strftime("%Y/%m/%d %H:%M"),
            "uploader": self.uploader or "",
            "update_notes": self.update_notes or "",
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in {"html", "zip"}


def save_uploaded_file(file, prototype_id, preview_id):
    """Save the file and prepare its preview directory. Returns (data_dict, error)."""
    original_filename = file.filename
    ext = original_filename.rsplit(".", 1)[1].lower() if "." in original_filename else ""
    
    filename = secure_filename(original_filename)
    # 修复全中文文件名被 secure_filename 过滤后丢失扩展名的问题
    if not filename:
        filename = f"file_{secrets.token_hex(4)}.{ext}"
    elif "." not in filename:
        filename = f"{filename}.{ext}"

    # 每次上传使用独立子目录，避免同名文件覆盖历史版本
    version_id = secrets.token_hex(8)
    src_dir = os.path.join(UPLOAD_DIR, "sources", str(prototype_id), version_id)
    os.makedirs(src_dir, exist_ok=True)
    file_path = os.path.join(src_dir, filename)
    file.save(file_path)
    file_size = os.path.getsize(file_path)

    preview_dir = os.path.join(UPLOAD_DIR, "previews", preview_id)

    if ext == "zip":
        if os.path.exists(preview_dir):
            shutil.rmtree(preview_dir)
        os.makedirs(preview_dir, exist_ok=True)
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                zf.extractall(preview_dir)
        except zipfile.BadZipFile:
            return None, "ZIP 文件损坏或格式不正确"

        # If ZIP extracted a single top-level folder, promote its contents
        items = [i for i in os.listdir(preview_dir) if not i.startswith("__")]
        if len(items) == 1 and os.path.isdir(os.path.join(preview_dir, items[0])):
            subdir = os.path.join(preview_dir, items[0])
            for item in os.listdir(subdir):
                shutil.move(os.path.join(subdir, item), os.path.join(preview_dir, item))
            shutil.rmtree(subdir)
    else:
        os.makedirs(preview_dir, exist_ok=True)
        shutil.copy2(file_path, os.path.join(preview_dir, "index.html"))

    return {
        "file_name": filename,
        "file_path": file_path,
        "file_size": file_size,
        "file_type": ext,
        "preview_dir": preview_dir,
    }, None


def find_entry_html(preview_dir):
    """Return the relative path of the main HTML file inside preview_dir."""
    for candidate in ("index.html", "index.htm"):
        if os.path.isfile(os.path.join(preview_dir, candidate)):
            return candidate
    for f in os.listdir(preview_dir):
        if f.lower().endswith((".html", ".htm")) and os.path.isfile(
            os.path.join(preview_dir, f)
        ):
            return f
    # One level deep
    for d in os.listdir(preview_dir):
        subdir = os.path.join(preview_dir, d)
        if os.path.isdir(subdir):
            for candidate in ("index.html", "index.htm"):
                if os.path.isfile(os.path.join(subdir, candidate)):
                    return os.path.join(d, candidate).replace("\\", "/")
    return None


def cleanup_prototype(p):
    preview_dir = os.path.join(UPLOAD_DIR, "previews", p.preview_id)
    if os.path.exists(preview_dir):
        shutil.rmtree(preview_dir)
    src_dir = os.path.join(UPLOAD_DIR, "sources", str(p.id))
    if os.path.exists(src_dir):
        shutil.rmtree(src_dir)


def _trim_records(prototype_id, keep: int = 10):
    """每个原型只保留最新的 keep 条上传记录，超出的删除文件并移除记录。"""
    all_records = (
        UploadRecord.query
        .filter_by(prototype_id=prototype_id)
        .order_by(UploadRecord.upload_time.desc())
        .all()
    )
    for old in all_records[keep:]:
        if old.file_path:
            # 删除整个版本子目录（父目录即 version_id 目录）
            version_dir = os.path.dirname(old.file_path)
            if os.path.isdir(version_dir) and os.path.exists(version_dir):
                try:
                    shutil.rmtree(version_dir)
                except OSError:
                    pass
            elif os.path.exists(old.file_path):
                try:
                    os.remove(old.file_path)
                except OSError:
                    pass
        db.session.delete(old)


# ---------------------------------------------------------------------------
# Routes – pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Routes – modules
# ---------------------------------------------------------------------------

@app.route("/api/modules", methods=["GET"])
def list_modules():
    modules = Module.query.order_by(Module.sort_order, Module.created_at).all()
    total = Prototype.query.count()
    return jsonify({"modules": [m.to_dict() for m in modules], "total": total})


@app.route("/api/modules", methods=["POST"])
def create_module():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "模块名称不能为空"}), 400
    if Module.query.filter_by(name=name).first():
        return jsonify({"error": "模块名称已存在"}), 400
    m = Module(name=name)
    db.session.add(m)
    db.session.commit()
    return jsonify(m.to_dict()), 201


@app.route("/api/modules/<int:mid>", methods=["PUT"])
def update_module(mid):
    m = db.get_or_404(Module, mid)
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "模块名称不能为空"}), 400
    existing = Module.query.filter_by(name=name).first()
    if existing and existing.id != mid:
        return jsonify({"error": "模块名称已存在"}), 400
    m.name = name
    db.session.commit()
    return jsonify(m.to_dict())


@app.route("/api/modules/<int:mid>", methods=["DELETE"])
def delete_module(mid):
    m = db.get_or_404(Module, mid)
    for p in m.prototypes:
        cleanup_prototype(p)
    db.session.delete(m)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/modules/reorder", methods=["PUT"])
def reorder_modules():
    ids = request.get_json(force=True).get("ids", [])
    for i, mid in enumerate(ids):
        m = db.session.get(Module, int(mid))
        if m:
            m.sort_order = i
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes – prototypes
# ---------------------------------------------------------------------------

@app.route("/api/prototypes", methods=["GET"])
def list_prototypes():
    module_id = request.args.get("module_id", type=int)
    q = Prototype.query
    if module_id:
        q = q.filter_by(module_id=module_id)
    items = q.order_by(Prototype.updated_at.desc()).all()
    return jsonify([p.to_dict() for p in items])


@app.route("/api/prototypes", methods=["POST"])
def create_prototype():
    name = (request.form.get("name") or "").strip()
    module_id = request.form.get("module_id", type=int)
    description = (request.form.get("description") or "").strip()

    if not name:
        return jsonify({"error": "原型名称不能为空"}), 400
    if not module_id or not db.session.get(Module, module_id):
        return jsonify({"error": "请选择有效的模块"}), 400

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "请上传原型文件"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "仅支持 .html 文件或 .zip 压缩包"}), 400

    p = Prototype(name=name, module_id=module_id, description=description)
    db.session.add(p)
    db.session.flush()

    record_data, err = save_uploaded_file(file, p.id, p.preview_id)
    if err:
        db.session.rollback()
        return jsonify({"error": err}), 400

    db.session.add(UploadRecord(prototype_id=p.id, **record_data))
    db.session.commit()
    return jsonify(p.to_dict(detail=True)), 201


@app.route("/api/prototypes/<int:pid>", methods=["GET"])
def get_prototype(pid):
    p = db.get_or_404(Prototype, pid)
    return jsonify(p.to_dict(detail=True))


@app.route("/api/prototypes/<int:pid>", methods=["PUT"])
def update_prototype(pid):
    p = db.get_or_404(Prototype, pid)
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    module_id = data.get("module_id")
    if not name:
        return jsonify({"error": "原型名称不能为空"}), 400
    if module_id and not db.session.get(Module, module_id):
        return jsonify({"error": "模块不存在"}), 400
    p.name = name
    p.description = (data.get("description") or "").strip()
    if module_id:
        p.module_id = int(module_id)
    p.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(p.to_dict(detail=True))


@app.route("/api/prototypes/<int:pid>", methods=["DELETE"])
def delete_prototype(pid):
    p = db.get_or_404(Prototype, pid)
    cleanup_prototype(p)
    db.session.delete(p)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/prototypes/<int:pid>/upload", methods=["POST"])
def upload_prototype_file(pid):
    p = db.get_or_404(Prototype, pid)
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "请上传文件"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "仅支持 .html 文件或 .zip 压缩包"}), 400

    record_data, err = save_uploaded_file(file, p.id, p.preview_id)
    if err:
        return jsonify({"error": err}), 400

    record = UploadRecord(
        prototype_id=p.id,
        uploader=(request.form.get("uploader") or "").strip(),
        update_notes=(request.form.get("update_notes") or "").strip(),
        **record_data,
    )
    db.session.add(record)
    p.updated_at = datetime.utcnow()
    db.session.flush()
    _trim_records(p.id)
    db.session.commit()
    return jsonify(p.to_dict(detail=True))


@app.route("/api/prototypes/<int:pid>/download")
def download_prototype(pid):
    p = db.get_or_404(Prototype, pid)
    latest = p.latest
    if not latest:
        abort(404)
    return send_file(latest.file_path, as_attachment=True, download_name=latest.file_name)


@app.route("/api/records/<int:rid>/download")
def download_record(rid):
    r = db.get_or_404(UploadRecord, rid)
    if not r.file_path or not os.path.exists(r.file_path):
        abort(404)
    return send_file(r.file_path, as_attachment=True, download_name=r.file_name)


# ---------------------------------------------------------------------------
# Routes – preview
# ---------------------------------------------------------------------------

@app.route("/preview/<preview_id>")
def preview(preview_id):
    p = Prototype.query.filter_by(preview_id=preview_id).first_or_404()
    latest = p.latest
    if not latest or not latest.preview_dir:
        abort(404)
    entry = find_entry_html(latest.preview_dir)
    if not entry:
        abort(404)
    return send_from_directory(latest.preview_dir, entry)


@app.route("/preview/<preview_id>/<path:filename>")
def preview_asset(preview_id, filename):
    p = Prototype.query.filter_by(preview_id=preview_id).first_or_404()
    latest = p.latest
    if not latest or not latest.preview_dir:
        abort(404)
    return send_from_directory(latest.preview_dir, filename)


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

os.makedirs(os.path.join(UPLOAD_DIR, "sources"), exist_ok=True)
os.makedirs(os.path.join(UPLOAD_DIR, "previews"), exist_ok=True)

with app.app_context():
    db.create_all()
    with db.engine.connect() as conn:
        try:
            conn.execute(db.text("ALTER TABLE modules ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        except Exception:
            pass

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8111, use_reloader=False)
