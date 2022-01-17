namespace Docstore.Application.Models
{
    public class PagedResult<T> where T : class
    {
        public IEnumerable<T> Results { get; set; } = Enumerable.Empty<T>();
        public Pagination Pagination { get; set; }


        public PagedResult(IEnumerable<T> results, Pagination pagination)
        {
            Results = results;
            Pagination = pagination;
        }
        public PagedResult(IEnumerable<T> results, int count, int pageNumber, int pageSize)
        {
            var totalPages = (int)Math.Ceiling((decimal)count / pageSize);

            Results = results;
            Pagination = new Pagination { PageSize = pageSize, CurrentPage = pageNumber, TotalItems = count, TotalPages = totalPages };
        }


        #region statics
        public static PagedResult<TModel> Empty<TModel>() where TModel : class
            => new(Enumerable.Empty<TModel>(), new Pagination());
        #endregion
    }
}
