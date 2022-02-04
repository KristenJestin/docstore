using Docstore.Application.Models;
using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class HomeIndexViewModel
    {
        public IEnumerable<Document> LastDocuments { get; set; } = Enumerable.Empty<Document>();
        public PagedResult<ElementItem> Elements { get; set; } = PagedResult<ElementItem>.Empty<ElementItem>();
    }
}
