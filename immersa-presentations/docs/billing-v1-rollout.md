# COBROS v1 — configuración y rollout

Este documento congela la configuración aprobada para el environment temporal. No habilita cobros en producción.

## Objetos Stripe (modo de pruebas)

Crear un solo producto recurrente `IMMERSA`. Sus cuatro precios deben pertenecer al mismo producto; Stripe sólo puede programar downgrades desde Customer Portal entre precios del mismo producto.

| Precio | Importe total | Moneda | Intervalo |
| --- | ---: | --- | --- |
| SPEAKER mensual | $500.00 | MXN | month |
| SPEAKER anual | $5,000.00 | MXN | year |
| SPEAKER PRO mensual | $1,500.00 | MXN | month |
| SPEAKER PRO anual | $15,000.00 | MXN | year |

Los importes son IVA incluido. COBROS v1 no activa Stripe Tax ni pruebas gratuitas. La facturación CFDI sigue siendo manual.

Crear cuatro cupones de importe fijo y duración `forever` para Precio Fundadores:

| Cupón | Descuento fijo |
| --- | ---: |
| SPEAKER mensual | $101.00 MXN |
| SPEAKER anual | $1,010.00 MXN |
| SPEAKER PRO mensual | $301.00 MXN |
| SPEAKER PRO anual | $3,010.00 MXN |

No combinar el cupón Fundadores con otro descuento. La elegibilidad inicial termina el 31 de octubre de 2026 a las 11:59:59 p.m. de Ciudad de México; una suscripción Fundadores activa conserva el cupón correspondiente cuando cambia de plan o intervalo.

## Customer Portal

Crear una configuración exclusiva para IMMERSA con:

- método de pago: habilitado;
- historial de facturas/recibos: habilitado;
- cancelación: al final del periodo, sin prorrateo;
- cambio de precio: habilitado sólo para los cuatro precios del producto IMMERSA;
- prorrateo de upgrades: `always_invoice`;
- downgrades: programados al final del periodo;
- cambio anual a mensual: programado al final del periodo;
- códigos promocionales: habilitarlos sólo para campañas aprobadas.

IMMERSA abre `subscription_update_confirm` para el precio seleccionado. Stripe muestra el crédito, el cargo, la fecha y cualquier autenticación 3DS antes de confirmar. Un webhook posterior reconcilia el plan efectivo; el retorno del navegador nunca concede acceso.

## Variables Railway

Configurar únicamente como variables privadas del environment temporal:

```text
IMMERSA_BILLING_ENABLED=true
IMMERSA_BILLING_CHECKOUT_ENABLED=true
IMMERSA_FOUNDERS_OFFER_END_AT=2026-10-31T23:59:59-06:00
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_SPEAKER_MONTHLY_PRICE_ID=price_...
STRIPE_SPEAKER_ANNUAL_PRICE_ID=price_...
STRIPE_SPEAKER_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_SPEAKER_PRO_ANNUAL_PRICE_ID=price_...
STRIPE_FOUNDERS_SPEAKER_MONTHLY_COUPON_ID=...
STRIPE_FOUNDERS_SPEAKER_ANNUAL_COUPON_ID=...
STRIPE_FOUNDERS_SPEAKER_PRO_MONTHLY_COUPON_ID=...
STRIPE_FOUNDERS_SPEAKER_PRO_ANNUAL_COUPON_ID=...
```

Mantener en producción:

```text
IMMERSA_BILLING_ENABLED=false
IMMERSA_BILLING_CHECKOUT_ENABLED=false
```

No guardar llaves, secretos, IDs reales de objetos ni payloads con datos personales en GitHub.

## Webhook temporal

Apuntar el endpoint de Stripe al environment temporal:

```text
POST /api/billing/webhooks/stripe
```

Suscribir únicamente:

- `checkout.session.completed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.pending_update_applied`
- `customer.subscription.pending_update_expired`

## Matriz de aprobación

No habilitar producción hasta documentar evidencia de:

- pago mensual y anual exitosos para ambos planes;
- Checkout cancelado;
- pago fallido y recuperación;
- webhook con firma inválida, duplicado, retrasado y fuera de orden;
- upgrade inmediato con prorrateo y confirmación de pago;
- downgrade al final del periodo;
- cambio mensual a anual inmediato con crédito;
- cambio anual a mensual al final del periodo;
- cancelación programada y efectiva;
- cupón Fundadores y código promocional permitido;
- solicitud CFDI ordinaria y extemporánea;
- piloto, cortesía y activación manual sin datos Stripe falsos;
- presentación activa y recursos excedentes sin borrado automático.

La ausencia de un deployment asociado al SHA o de evidencia Stripe en modo de pruebas bloquea el rollout. El merge a `main` requiere confirmación expresa.
