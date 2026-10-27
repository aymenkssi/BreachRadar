# Point d'entrée de l'API : l'application de server.py + comptes, abonnement, Premium et administration.
import accounts
import admin
import billing
import premium
import privacy
import promo
from server import app, db, startup_hooks

for router in (accounts.router, privacy.router, billing.router, premium.router, admin.router, admin.public_router,
               promo.router, promo.public_router):
    app.include_router(router)


async def create_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index("subscription.id", sparse=True)
    await db.email_codes.create_index("key", unique=True)
    await db.monitors.create_index([("user_id", 1), ("email", 1)], unique=True)
    await db.investigations.create_index([("owner", 1), ("created_at", -1)])
    await db.watchlist.create_index([("owner", 1), ("created_at", -1)])
    await db.email_stats.create_index("date", unique=True)
    await db.platform_settings.create_index("key", unique=True)
    await db.audit_logs.create_index("created_at")
    await db.promo_codes.create_index("code", unique=True)
    await db.promo_redemptions.create_index([("code", 1), ("user_id", 1)], unique=True)
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)


startup_hooks.append(create_indexes)
