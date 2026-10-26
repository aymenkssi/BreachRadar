# Crée chez PayPal le produit « BreachRadar Premium » et ses deux plans d'abonnement (une seule fois),
# puis affiche les lignes à copier dans .env. Utilise PAYPAL_MODE / PAYPAL_CLIENT_ID / PAYPAL_SECRET.
#   docker compose run --rm backend python paypal_setup.py 4.99 49.99
import sys

from billing import PAYPAL_MODE, _paypal_sync


def plan(product_id: str, name: str, unit: str, price: str) -> str:
    body = {
        "product_id": product_id,
        "name": name,
        "status": "ACTIVE",
        "billing_cycles": [{
            "frequency": {"interval_unit": unit, "interval_count": 1},
            "tenure_type": "REGULAR",
            "sequence": 1,
            "total_cycles": 0,
            "pricing_scheme": {"fixed_price": {"value": price, "currency_code": "EUR"}},
        }],
        "payment_preferences": {"auto_bill_outstanding": True, "payment_failure_threshold": 1},
    }
    return _paypal_sync("POST", "/v1/billing/plans", body)["id"]


def main(monthly: str, yearly: str) -> None:
    product = _paypal_sync("POST", "/v1/catalogs/products", {
        "name": "BreachRadar Premium", "type": "SERVICE", "category": "SOFTWARE",
        "description": "Veille des fuites de données et rapport des mots de passe",
    })
    monthly_id = plan(product["id"], "BreachRadar Premium mensuel", "MONTH", monthly)
    yearly_id = plan(product["id"], "BreachRadar Premium annuel", "YEAR", yearly)
    fr = lambda p: p.replace(".", ",") + " €"  # noqa: E731
    print(f"# Plans PayPal créés en mode {PAYPAL_MODE} : à copier dans .env")
    print(f"PAYPAL_PLAN_MONTHLY={monthly_id}")
    print(f"PAYPAL_PLAN_YEARLY={yearly_id}")
    print(f"PRICE_MONTHLY_LABEL={fr(monthly)}")
    print(f"PRICE_YEARLY_LABEL={fr(yearly)}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage : python paypal_setup.py PRIX_MENSUEL PRIX_ANNUEL   (ex. 4.99 49.99)")
    main(sys.argv[1], sys.argv[2])
