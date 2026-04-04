import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Product, PriceBook, PriceBookEntry } from "@/types/crm";

// ─── Products ────────────────────────────────────────────

export function useProducts(includeInactive = false) {
  return useQuery({
    queryKey: ["products", { includeInactive }],
    queryFn: async () => {
      let query = supabase.from("products").select("*").order("name");
      if (!includeInactive) {
        query = query.eq("is_active", true);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Product[];
    },
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Product>) => {
      const { data, error } = await supabase
        .from("products")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Product> & { id: string }) => {
      const { data, error } = await supabase
        .from("products")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

// ─── Price Books ─────────────────────────────────────────

export function usePriceBooks() {
  return useQuery({
    queryKey: ["price_books"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_books")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as PriceBook[];
    },
  });
}

export function useCreatePriceBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<PriceBook>) => {
      const { data, error } = await supabase
        .from("price_books")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as PriceBook;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_books"] });
    },
  });
}

export function useUpdatePriceBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<PriceBook> & { id: string }) => {
      const { data, error } = await supabase
        .from("price_books")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as PriceBook;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_books"] });
    },
  });
}

// ─── Price Book Entries ──────────────────────────────────

export function usePriceBookEntries(priceBookId: string | undefined) {
  return useQuery({
    queryKey: ["price_book_entries", priceBookId],
    queryFn: async () => {
      if (!priceBookId) throw new Error("Missing price book ID");
      const { data, error } = await supabase
        .from("price_book_entries")
        .select("*, product:products!product_id(id, name, code)")
        .eq("price_book_id", priceBookId)
        .order("fte_range");
      if (error) throw error;
      return data as PriceBookEntry[];
    },
    enabled: !!priceBookId,
  });
}

export function useCreatePriceBookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      price_book_id: string;
      product_id: string;
      fte_range: string | null;
      unit_price: number;
    }) => {
      const { data, error } = await supabase
        .from("price_book_entries")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as PriceBookEntry;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["price_book_entries", vars.price_book_id] });
    },
  });
}

export function useDeletePriceBookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, priceBookId }: { id: string; priceBookId: string }) => {
      const { error } = await supabase
        .from("price_book_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return priceBookId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["price_book_entries", vars.priceBookId] });
    },
  });
}
