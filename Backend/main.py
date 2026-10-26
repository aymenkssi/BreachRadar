# Point d'entrée de l'API : l'application de server.py + comptes, abonnement et fonctions Premium.
import accounts
import billing
import premium
from server import app, db

for module in (accounts, billing, premium):
    app.include_router(module.router)


@app.on_event("startup")
async def create_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index("subscription.id", sparse=True)
    await db.email_codes.create_index("key", unique=True)
    await db.monitors.create_index([("user_id", 1), ("email", 1)], unique=True)
    await db.investigations.create_index([("owner", 1), ("created_at", -1)])
    await db.watchlist.create_index([("owner", 1), ("created_at", -1)])
