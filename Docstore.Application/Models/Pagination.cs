namespace Docstore.Application.Models
{
    public class Pagination
    {
        public int CurrentPage { get; set; }
        public int PageSize { get; set; }
        public int TotalPages { get; set; }
        public int TotalItems { get; set; }

        public int? NextPage
            => CurrentPage < TotalPages ? CurrentPage + 1 : null;
        public int? PreviousPage
            => CurrentPage > 1 ? CurrentPage - 1 : null;


        public int GetNumberOfPagesBefore()
        {
            var beforePage = CurrentPage - 1;

            if (CurrentPage == TotalPages)
                return beforePage - 2;
            else if (CurrentPage == TotalPages - 1)
                return beforePage - 1;

            return beforePage;
        }
        public int GetNumberOfPagesAfter()
        {
            var afterPage = CurrentPage + 1;

            if (CurrentPage == 1)
                return afterPage + 2;
            else if (CurrentPage == 2)
                return afterPage + 1;

            return afterPage;
        }
    }
}

