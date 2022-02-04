using Docstore.Application.Models;

namespace Docstore.Application.Interfaces
{
    public interface IGlobalRepository
    {
        Task<PagedResult<ElementItem>> GetDocumentsWithoutParentAndFolders(int userId, int pageNumber, int pageSize);
    }
}
