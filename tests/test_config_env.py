from __future__ import annotations

import os
from pathlib import Path

from pytest import MonkeyPatch

from backend.config import load_environment_file


def test_load_environment_file_preserves_process_values(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "MUSICAI_TEST_FROM_FILE='loaded value'\n"
        "MUSICAI_TEST_PRECEDENCE=from-file\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("MUSICAI_TEST_FROM_FILE", raising=False)
    monkeypatch.setenv("MUSICAI_TEST_PRECEDENCE", "from-process")

    load_environment_file(env_file)

    assert os.environ["MUSICAI_TEST_FROM_FILE"] == "loaded value"
    assert os.environ["MUSICAI_TEST_PRECEDENCE"] == "from-process"
