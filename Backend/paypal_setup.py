# Crée chez PayPal le produit « BreachRadar Premium » et ses deux plans d'abonnement, puis affiche les
# identifiants. Plus simple : bouton « Créer les formules » dans l'admin (onglet Paiement).
#   docker compose run --rm backend python paypal_setup.py 4.99 49.99
import asyncio
import sys

from billing import create_paypal_plans, get_config


def main(monthly: str, yearly: str) -> None:
    cfg = asyncio.run(get_config())
    ids = create_paypal_plans(cfg, monthly, yearly)
    print(f"# Plans PayPal créés en mode {cfg.paypal_mode}")
    print(f"PAYPAL_PLAN_MONTHLY={ids['monthly']}")
    print(f"PAYPAL_PLAN_YEARLY={ids['yearly']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage : python paypal_setup.py PRIX_MENSUEL PRIX_ANNUEL   (ex. 4.99 49.99)")
    main(sys.argv[1], sys.argv[2])
