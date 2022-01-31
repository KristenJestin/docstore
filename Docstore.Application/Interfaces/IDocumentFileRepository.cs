using Docstore.Domain.Entities;

namespace Docstore.Application.Interfaces
{
    public interface IDocumentFileRepository : IGenericRepository<DocumentFile>
    {
        Task<IReadOnlyList<DocumentFile>> GetFromParentAsync(int userId, int parentId);
    }
}
