using Docstore.Domain.Entities;

namespace Docstore.Application.Interfaces
{
    public interface IFolderRepository : IGenericRepository<Folder>
    {
        Task<IEnumerable<Folder>> SearchAsync(int userId, string term, uint size = 10);
    }
}
