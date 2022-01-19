using Docstore.Domain.Entities;

namespace Docstore.Application.Interfaces
{
    public interface IFolderRepository : IGenericRepository<Folder>
    {
        Task<IEnumerable<Folder>> SearchAsync(string term, uint size = 10);
    }
}
