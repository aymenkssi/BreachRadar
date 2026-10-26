# Planificateur (conteneur « scheduler ») : vérifie chaque jour les adresses surveillées et
# envoie les alertes, relit les abonnements en cours (au cas où un webhook serait perdu) et applique
# les durées de conservation des données (privacy.purge_expired_data).
import asyncio
import logging
import os

import server  # noqa: F401  (configure la journalisation et la base)
from billing import refresh_subscriptions, send_renewal_reminders
from premium import run_monitor_checks
from privacy import purge_expired_data

logger = logging.getLogger("scheduler")
INTERVAL_HOURS = float(os.environ.get("MONITOR_INTERVAL_HOURS", "24"))


async def run_once() -> None:
    alerted = await run_monitor_checks()
    logger.info(f"Veille terminée : {alerted} adresse(s) avec de nouvelles fuites")
    await refresh_subscriptions()
    logger.info(f"Rappels de reconduction envoyés : {await send_renewal_reminders()}")
    logger.info(f"Purge des données expirées : {await purge_expired_data()}")


async def main() -> None:
    logger.info(f"Planificateur démarré (toutes les {INTERVAL_HOURS} h)")
    while True:
        try:
            await run_once()
        except Exception as e:
            logger.exception(f"Passe du planificateur échouée : {e}")
        await asyncio.sleep(INTERVAL_HOURS * 3600)


if __name__ == "__main__":
    asyncio.run(main())
