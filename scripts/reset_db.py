from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api import db

if __name__ == "__main__":
    db.init_all(reset=True)
    print(f"Initialized platform DB: {db.DB_PATH}")
    print(f"Initialized business DB: {db.BUSINESS_DB_PATH}")
