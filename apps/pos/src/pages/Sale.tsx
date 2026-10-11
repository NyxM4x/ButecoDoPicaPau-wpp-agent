import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PaymentModal } from '../components/Payment';
import { ProductImage } from '../components/ProductImage';
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Spinner, Textarea, cx, toast } from '../components/ui';
import { errorMessage, isApiError, requestWithStatus } from '../lib/api';
import { MAX_QUANTITY, buildOrderBody, cartCount, cartTotal, useCart, type CartLine } from '../lib/cart';
import { money } from '../lib/format';
import { byOrder, keys, useCashSession, useCategories, useProducts, usePromotions } from '../lib/queries';
import type { Order, Product, Promotion } from '../lib/types';

const ALL = 'all';
const PROMOS = 'promos';

export function SalePage() {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const products = useProducts();
  const promotions = usePromotions();
  const cash = useCashSession();
  const cart = useCart();
  const [tab, setTab] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState<Order | null>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  // Último intento enviado: si la red falla se reintenta con la MISMA clave y el
  // MISMO cuerpo. Si el carrito cambió, la clave vieja ya no sirve.
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const activePromotions = useMemo(() => byOrder((promotions.data ?? []).filter((promo) => promo.status === 'activa')), [promotions.data]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const categoryRank = new Map(byOrder(categories.data ?? []).map((category, index) => [category.id, index]));
    return byOrder(products.data ?? [])
      .filter((product) => (tab === ALL || product.categoryId === tab) && (term === '' || product.name.toLowerCase().includes(term)))
      .sort((a, b) => (categoryRank.get(a.categoryId) ?? 0) - (categoryRank.get(b.categoryId) ?? 0));
  }, [products.data, categories.data, tab, search]);

  const createOrder = useMutation({
    mutationFn: async () => {
      const body = JSON.stringify(buildOrderBody(cart));
      let key = cart.idempotencyKey ?? crypto.randomUUID();
      if (attempt.current && attempt.current.key === key && attempt.current.body !== body) key = crypto.randomUUID();
      attempt.current = { key, body };
      useCart.setState({ idempotencyKey: key });
      return requestWithStatus<Order>('POST', '/orders', { rawBody: body, idempotencyKey: key });
    },
    onSuccess: ({ status, data }) => {
      attempt.current = null;
      cart.clear();
      // 200 = el backend ya tenía esa venta: no es un cobro nuevo.
      if (status === 200) toast.ok(`El pedido ${data.orderNumber} ya estaba registrado.`);
      setPaying(data);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => {
      if (isApiError(error, 'product_unavailable') || isApiError(error, 'promotion_unavailable')) {
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: keys.promotions });
      }
      toast.error(errorMessage(error));
    },
  });

  const loading = categories.isPending || products.isPending || promotions.isPending;
  const failed = categories.error ?? products.error ?? promotions.error;
  const count = cartCount(cart.lines);
  const total = cartTotal(cart.lines);

  return (
    <div className="grid lg:h-full lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto">
        {cash.data === null && (
          <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            La caja está cerrada: puedes tomar pedidos, pero no cobrarlos.{' '}
            <Link to="/caja" className="font-semibold underline">
              Abrir caja
            </Link>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" placeholder="Buscar producto…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            <TabButton active={tab === ALL} onClick={() => setTab(ALL)}>
              Todo
            </TabButton>
            {byOrder(categories.data ?? []).map((category) => (
              <TabButton key={category.id} active={tab === category.id} onClick={() => setTab(category.id)}>
                {category.name}
              </TabButton>
            ))}
            {activePromotions.length > 0 && (
              <TabButton active={tab === PROMOS} onClick={() => setTab(PROMOS)}>
                Promociones
              </TabButton>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-16 text-slate-400">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {failed && <ErrorNote>{errorMessage(failed)}</ErrorNote>}

        {!loading && !failed && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {(tab === ALL || tab === PROMOS) &&
              search.trim() === '' &&
              activePromotions.map((promotion) => <PromotionTile key={promotion.id} promotion={promotion} onAdd={() => cart.addPromotion(promotion)} />)}
            {tab !== PROMOS && visibleProducts.map((product) => <ProductTile key={product.id} product={product} onAdd={() => cart.addProduct(product)} />)}
          </div>
        )}
        {!loading && !failed && tab !== PROMOS && visibleProducts.length === 0 && activePromotions.length === 0 && (
          <EmptyState title="No hay productos para mostrar">Carga el menú desde la pantalla Menú.</EmptyState>
        )}
      </div>

      <aside ref={cartRef} className="flex flex-col border-t border-slate-200 bg-white pb-20 lg:min-h-0 lg:border-l lg:border-t-0 lg:pb-0">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-bold">
            <ShoppingCart className="h-5 w-5" />
            Pedido
          </h2>
          {cart.lines.length > 0 && (
            <Button variant="ghost" size="sm" onClick={cart.clear}>
              <Trash2 className="h-4 w-4" />
              Vaciar
            </Button>
          )}
        </header>

        <div className="flex-1 space-y-2 p-4 lg:min-h-0 lg:overflow-y-auto">
          {cart.lines.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Toca un producto para agregarlo.</p>}
          {cart.lines.map((line) => (
            <CartRow key={`${line.kind}-${line.id}`} line={line} onQuantity={(quantity) => cart.setQuantity(line.kind, line.id, quantity)} />
          ))}
        </div>

        <div className="space-y-3 border-t border-slate-200 p-4">
          <Field label="Cliente">
            <Input placeholder="Cliente mostrador" maxLength={100} value={cart.customerName} onChange={(event) => cart.setField('customerName', event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Segmented
              label="Tipo"
              value={cart.deliveryType}
              options={[
                { value: 'pickup', label: 'Para llevar' },
                { value: 'dine_in', label: 'Mesa' },
              ]}
              onChange={(value) => cart.setField('deliveryType', value)}
            />
            <Segmented
              label="Pago"
              value={cart.paymentMethod}
              options={[
                { value: 'cash', label: 'Efectivo' },
                { value: 'qr', label: 'QR' },
              ]}
              onChange={(value) => cart.setField('paymentMethod', value)}
            />
          </div>
          <Field label="Nota para cocina">
            <Textarea rows={2} maxLength={500} placeholder="Sin cebolla, bien cocido…" value={cart.notes} onChange={(event) => cart.setField('notes', event.target.value)} />
          </Field>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-500">Total estimado</span>
            <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
          </div>
          <Button size="lg" className="w-full" disabled={cart.lines.length === 0} busy={createOrder.isPending} onClick={() => createOrder.mutate()}>
            Confirmar pedido
          </Button>
        </div>
      </aside>

      {count > 0 && (
        <button
          type="button"
          onClick={() => cartRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="fixed inset-x-3 bottom-3 z-20 flex h-12 items-center justify-between rounded-xl bg-brand-600 px-4 font-semibold text-white shadow-lg lg:hidden"
        >
          <span>Ver pedido ({count})</span>
          <span className="tabular-nums">{money(total)}</span>
        </button>
      )}

      {paying && <PaymentModal order={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50')}
    >
      {children}
    </button>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cx('h-8 rounded-md text-sm font-semibold', value === option.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProductTile({ product, onAdd }: { product: Product; onAdd: () => void }) {
  return (
    <button
      type="button"
      disabled={!product.isAvailable}
      onClick={onAdd}
      className="group flex flex-col overflow-hidden rounded-xl bg-white text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-2 hover:ring-brand-500 disabled:opacity-60 disabled:hover:ring-1 disabled:hover:ring-slate-200"
    >
      <div className="relative">
        <ProductImage product={product} className="aspect-[4/3] w-full" />
        {!product.isAvailable && (
          <Badge tone="red" className="absolute left-2 top-2">
            Agotado
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="line-clamp-2 text-sm font-semibold leading-snug">{product.name}</span>
        <span className="mt-auto text-sm font-bold tabular-nums text-brand-700">{money(product.price)}</span>
      </div>
    </button>
  );
}

function PromotionTile({ promotion, onAdd }: { promotion: Promotion; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex flex-col gap-1 rounded-xl bg-brand-50 p-3 text-left shadow-sm ring-1 ring-brand-500/40 transition hover:ring-2 hover:ring-brand-500"
    >
      <Badge tone="orange">Promoción</Badge>
      <span className="text-sm font-bold leading-snug">{promotion.name}</span>
      <span className="text-xs text-slate-600">{promotion.items.map((item) => `${item.quantity}× ${item.productName}`).join(' + ')}</span>
      <span className="mt-auto pt-1 text-sm font-bold tabular-nums text-brand-700">{money(promotion.promoPrice)}</span>
    </button>
  );
}

function CartRow({ line, onQuantity }: { line: CartLine; onQuantity: (quantity: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{line.name}</p>
        <p className="text-xs text-slate-500">
          {money(line.unitPrice)} {line.kind === 'promotion' && '· promoción'}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Quitar uno" onClick={() => onQuantity(line.quantity - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-sm font-bold tabular-nums">{line.quantity}</span>
        <button
          type="button"
          aria-label="Agregar uno"
          disabled={line.quantity >= MAX_QUANTITY}
          onClick={() => onQuantity(line.quantity + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <span className="w-20 text-right text-sm font-bold tabular-nums">{money(line.unitPrice * line.quantity)}</span>
    </div>
  );
}
