using Docstore.Domain.Entities.Abstracts;

namespace Docstore.Application.Interfaces
{
    public interface IGenericRepository<T> where T : UserOwnsBaseEntity
    {
        Task<T?> FindByIdAsync(int userId, int id);
        Task<IReadOnlyList<T>> FindByIdsAsync(int userId, params int[] ids);
        Task<IReadOnlyList<T>> GetAllAsync(int userId);
        Task<T> AddAsync(T entity, bool save = false);
        Task UpdateAsync(T entity, bool save = false);
        Task DeleteAsync(T entity, bool save = false);
    }
}
