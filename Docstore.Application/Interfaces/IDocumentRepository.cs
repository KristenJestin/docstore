using Docstore.Application.Models;
using Docstore.Domain.Entities;
using System.Linq.Expressions;

namespace Docstore.Application.Interfaces
{
    public interface IDocumentRepository : IGenericRepository<Document>
    {
        Task<PagedResult<Document>> GetPagedReponseAsync(int pageNumber, int pageSize, string? search = null, int? tag = null, int? folder = null, Expression<Func<Document, bool>>? where = null);
        Task<Document?> FindByIdWithTypeAndTagsAndFileAsync(int id);
    }
}
