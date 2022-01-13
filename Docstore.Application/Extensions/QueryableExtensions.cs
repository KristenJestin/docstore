namespace Docstore.Application.Extensions
{
    public static class QueryableExtensions
    {
        public static IQueryable<T> Paginate<T>(this IQueryable<T> source, int page, int size)
            => source.Skip((page - 1) * size).Take(size);
    }
}
