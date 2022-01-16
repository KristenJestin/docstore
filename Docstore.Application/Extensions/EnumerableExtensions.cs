namespace Docstore.Application.Extensions
{
    public static class EnumerableExtensions
    {
        public static IEnumerable<(T, int)> WithIndex<T>(this IEnumerable<T> list)
            => list.Select((value, i) => (value, i));
    }
}
