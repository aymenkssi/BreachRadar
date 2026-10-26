import os
import sys
from pathlib import Path

# server.py lit ces variables à l'import ; Motor ne se connecte qu'à la première requête.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "breachradar_test")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
