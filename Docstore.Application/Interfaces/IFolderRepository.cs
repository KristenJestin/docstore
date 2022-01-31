using Docstore.Application.Models;
using Docstore.Domain.Entities;
using System.Linq.Expressions;

namespace Docstore.Application.Interfaces
{
    public interface IFolderRepository : IGenericRepository<Folder>
    {
        Task<PagedResult<Folder>> GetPagedReponseAsync(int userId, int pageNumber, int pageSize, string? search = null, Expression<Func<Folder, bool>>? where = null);
        Task<IEnumerable<Folder>> SearchAsync(int userId, string term, uint size = 10);
    }
}
