import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Page } from '../../components/Layout';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle, toast, type Tone } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { PROMOTION_STATUS_LABEL, money } from '../../lib/format';
import { byOrder, keys, useProducts, usePromotions } from '../../lib/queries';
import type { Product, Promotion, PromotionStatus } from '../../lib/types';

const STATUS_TONE: Record<PromotionStatus, Tone> = {
  activa: 'green',
  agotada: 'red',
  sin_ahorro: 'amber',
  inactiva: 'neutral',
  archivada: 'neutral',
  programada: 'blue',
  expirada: 'neutral',
};

const STATUS_HINT: Partial<Record<PromotionStatus, string>> = {
  agotada: 'Uno de sus productos está agotado u oculto.',
  sin_ahorro: 'El precio de la promoción no es menor que la suma de sus productos.',
};

export function PromotionsPage() {
  const queryClient = useQueryClient();
  const promotions = usePromotions();
  const products = useProducts(true);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.promotions });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch<Promotion>(`/promotions/${id}/active`, { active }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });
  const setArchived = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.patch<Promotion>(`/promotions/${id}/archived`, { archived }),
    onSuccess: (_data, { archived }) => toast.ok(archived ? 'Promoción archivada.' : 'Promoción recuperada.'),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const list = byOrder(promotions.data ?? []).filter((promotion) => showArchived || !promotion.archivedAt);
  const archivedCount = (promotions.data ?? []).filter((promotion) => promotion.archivedAt).length;

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Promociones"
        subtitle="Combos de dos o más productos a un precio especial."
        actions={
          <Button onClick={() => setEditing('new')} disabled={(products.data ?? []).length < 2}>
            <Plus className="h-4 w-4" />
            Promoción
          </Button>
        }
      />

      {promotions.isPending && (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {promotions.isError && <ErrorNote>{errorMessage(promotions.error)}</ErrorNote>}
      {promotions.data && list.length === 0 && <EmptyState title="No hay promociones">Crea la primera con el botón de arriba.</EmptyState>}

      <div className="space-y-3">
        {list.map((promotion) => (
          <Card key={promotion.id} className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1 basis-64">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{promotion.name}</span>
                <Badge tone={STATUS_TONE[promotion.status]}>{PROMOTION_STATUS_LABEL[promotion.status]}</Badge>
              </p>
              <p className="text-sm text-slate-600">{promotion.items.map((item) => `${item.quantity}× ${item.productName}`).join(' + ')}</p>
              {STATUS_HINT[promotion.status] && <p className="text-xs text-amber-700">{STATUS_HINT[promotion.status]}</p>}
            </div>
            <span className="text-lg font-bold tabular-nums">{money(promotion.promoPrice)}</span>
            {promotion.archivedAt ? (
              <Button variant="secondary" size="sm" onClick={() => setArchived.mutate({ id: promotion.id, archived: false })}>
                Recuperar
              </Button>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Toggle label={`Activa: ${promotion.name}`} checked={promotion.isActive} disabled={setActive.isPending} onChange={(active) => setActive.mutate({ id: promotion.id, active })} />
                  Activa
                </label>
                <Button variant="ghost" size="sm" onClick={() => setEditing(promotion)}>
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setArchived.mutate({ id: promotion.id, archived: true })}>
                  Archivar
                </Button>
              </>
            )}
          </Card>
        ))}
      </div>

      {archivedCount > 0 && (
        <button type="button" className="mt-4 text-sm font-semibold text-slate-500 underline" onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? 'Ocultar archivadas' : `Ver archivadas (${archivedCount})`}
        </button>
      )}

      {editing && <PromotionForm promotion={editing === 'new' ? null : editing} products={byOrder(products.data ?? [])} onClose={() => setEditing(null)} />}
    </Page>
  );
}

interface Row {
  productId: string;
  quantity: string;
}

function PromotionForm({ promotion, products, onClose }: { promotion: Promotion | null; products: Product[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(promotion?.name ?? '');
  const [description, setDescription] = useState(promotion?.description ?? '');
  const [price, setPrice] = useState(promotion ? String(promotion.promoPrice) : '');
  const [rows, setRows] = useState<Row[]>(
    promotion
      ? promotion.items.map((item) => ({ productId: item.productId, quantity: String(item.quantity) }))
      : [
          { productId: products[0]?.id ?? '', quantity: '1' },
          { productId: products[1]?.id ?? '', quantity: '1' },
        ],
  );

  const priceOf = (id: string) => products.find((product) => product.id === id)?.price ?? 0;
  const regular = rows.reduce((sum, row) => sum + priceOf(row.productId) * (Number(row.quantity) || 0), 0);
  const distinct = new Set(rows.map((row) => row.productId)).size;
  // El backend exige al menos dos productos distintos: cuenta elementos, no unidades.
  const invalid = distinct < 2 || distinct !== rows.length;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        promoPrice: Number(price),
        items: rows.map((row) => ({ productId: row.productId, quantity: Math.max(1, Math.trunc(Number(row.quantity) || 1)) })),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      if (promotion) return api.patch<Promotion>(`/promotions/${promotion.id}`, body);
      // Una promoción nace inactiva: hace falta un segundo llamado para activarla.
      const created = await api.post<Promotion>('/promotions', body);
      return api.patch<Promotion>(`/promotions/${created.id}/active`, { active: true });
    },
    onSuccess: (saved) => {
      toast.ok(`Promoción ${saved.name} guardada.`);
      void queryClient.invalidateQueries({ queryKey: keys.promotions });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Modal title={promotion ? `Editar ${promotion.name}` : 'Nueva promoción'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre">
          <Input required autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Descripción (opcional)">
          <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Productos del combo</span>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input type="number" min={1} step="1" className="w-20" aria-label="Cantidad" value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
                <Select aria-label="Producto" value={row.productId} onChange={(event) => update(index, { productId: event.target.value })}>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {money(product.price)}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  aria-label="Quitar producto"
                  disabled={rows.length <= 2}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={rows.length >= products.length}
            onClick={() => {
              const used = new Set(rows.map((row) => row.productId));
              const next = products.find((product) => !used.has(product.id));
              if (next) setRows((current) => [...current, { productId: next.id, quantity: '1' }]);
            }}
          >
            <Plus className="h-4 w-4" />
            Agregar producto
          </Button>
          {invalid && <p className="mt-1 text-sm text-red-700">El combo necesita al menos dos productos distintos, sin repetir.</p>}
        </div>

        <Field label="Precio de la promoción (Bs)" hint={`Por separado costarían ${money(regular)}.`}>
          <Input type="number" inputMode="decimal" min={0.01} max={5000} step="0.5" required className="max-w-40" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>

        {save.isError && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" busy={save.isPending} disabled={invalid}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
