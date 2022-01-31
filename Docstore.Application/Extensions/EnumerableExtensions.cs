namespace Docstore.Application.Extensions
{
    public static class EnumerableExtensions
    {
        public static IEnumerable<(T, int)> WithIndex<T>(this IEnumerable<T> items)
            => items.Select((value, i) => (value, i));

        public static IEnumerable<T> Except<T, TKey>(this IEnumerable<T> items, IEnumerable<T> other, Func<T, TKey> getKeyFunc)
            => items
                .GroupJoin(other, getKeyFunc, getKeyFunc, (item, tempItems) => new { item, tempItems })
                .SelectMany(t => t.tempItems.DefaultIfEmpty(), (t, temp) => new { t, temp })
                .Where(t => ReferenceEquals(null, t.temp) || t.temp.Equals(default(T)))
                .Select(t => t.t.item);
    }
}
