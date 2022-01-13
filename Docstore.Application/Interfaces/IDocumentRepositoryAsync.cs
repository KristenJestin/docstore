using Docstore.Application.Models;
using Docstore.Domain.Entities;

namespace Docstore.Application.Interfaces
{
    public interface IDocumentRepositoryAsync : IGenericRepositoryAsync<Document>
    {
        Task<PagedResult<Document>> GetPagedReponseAsync(int user, int pageNumber, int pageSize, string? search = null, int? tag = null);
        Task<Document?> FindByIdWithTypeAndTagsAndFileAsync(int id);
    }
}
