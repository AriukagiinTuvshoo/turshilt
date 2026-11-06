from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_alembic_migration_graph_has_one_head():
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    scripts = ScriptDirectory.from_config(config)

    assert len(scripts.get_heads()) == 1
